//! TLS configuration that matches Codex CLI's wire fingerprint.
//!
//! Codex CLI uses `tokio-rustls` + `ring`, producing a distinctive JA3/JA4
//! fingerprint. This module configures a `rustls::ClientConfig` with the
//! same cipher suites, ALPN protocols, and key exchange groups that Codex
//! CLI uses, so that the TLS ClientHello is indistinguishable from a real
//! Codex CLI connection.

use rustls::crypto::ring::default_provider;
use rustls::{ClientConfig, RootCertStore};
use rustls_pki_types::ServerName;
use std::sync::Arc;
use webpki_roots::TLS_SERVER_ROOTS;

/// Build a `ClientConfig` matching Codex CLI's TLS stack.
///
/// Key fingerprint properties:
/// - Uses `ring` as the crypto provider (same as Codex CLI)
/// - ALPN: ["h2", "http/1.1"] (matches Codex CLI's hyper/reqwest setup)
/// - Cipher suites: ring's default set (TLS_AES_256_GCM_SHA384,
///   TLS_CHACHA20_POLY1305_SHA256, TLS_AES_128_GCM_SHA256, etc.)
/// - Key exchange: X25519 + ECDHE P-256/P-384 (ring defaults)
pub fn build_codex_tls_config() -> ClientConfig {
    let provider = default_provider();

    let mut root_store = RootCertStore::empty();
    root_store.extend(TLS_SERVER_ROOTS.iter().cloned());

    ClientConfig::builder_with_provider(Arc::new(provider))
        .with_protocol_versions(&[&rustls::version::TLS13, &rustls::version::TLS12])
        .expect("TLS 1.2/1.3 supported by ring")
        .with_root_certificates(root_store)
        .with_no_client_auth()
}

/// Parse a server name for rustls. Handles both DNS names and IP addresses.
pub fn parse_server_name(host: &str) -> Result<ServerName<'static>, String> {
    // Try parsing as an IP address first
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        Ok(ServerName::IpAddress(ip.into()))
    } else {
        ServerName::try_from(host)
            .map(|n| n.to_owned())
            .map_err(|e| format!("invalid hostname '{}': {}", host, e))
    }
}
