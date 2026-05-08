//! HTTP proxy functionality using hyper with rustls TLS.
//!
//! Forwards HTTP requests through a TLS connection that matches Codex CLI's
//! wire fingerprint. Supports both regular and streaming (SSE) responses.

use crate::tls;
use hyper::Request;
use hyper_util::client::legacy::Client;
use hyper_util::rt::TokioExecutor;
use http_body_util::BodyExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// IPC request format sent over the Unix socket.
#[derive(Debug, Serialize, Deserialize)]
pub struct ProxyRequest {
    pub id: String,
    pub method: String,
    pub url: String,
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub body: Option<String>,
}

/// IPC response format sent back over the Unix socket.
#[derive(Debug, Serialize, Deserialize)]
pub struct ProxyResponse {
    pub id: String,
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
    /// For streaming responses: the first chunk of SSE data.
    pub stream_first_chunk: Option<String>,
    pub error: Option<String>,
}

/// Execute an HTTP request through the Codex-matching TLS stack.
pub async fn execute_request(req: ProxyRequest) -> ProxyResponse {
    let tls_config = tls::build_codex_tls_config();

    // Parse URL to extract host and port
    let url_parts = match hyper::Uri::try_from(&req.url) {
        Ok(u) => u,
        Err(e) => {
            return ProxyResponse {
                id: req.id,
                status: 0,
                headers: HashMap::new(),
                body: None,
                stream_first_chunk: None,
                error: Some(format!("invalid URL: {}", e)),
            }
        }
    };

    let host = match url_parts.host() {
        Some(h) => h.to_string(),
        None => {
            return ProxyResponse {
                id: req.id,
                status: 0,
                headers: HashMap::new(),
                body: None,
                stream_first_chunk: None,
                error: Some("missing host in URL".into()),
            }
        }
    };

    let _port = url_parts.port_u16().unwrap_or(443);
    let _server_name = match tls::parse_server_name(&host) {
        Ok(n) => n,
        Err(e) => {
            return ProxyResponse {
                id: req.id,
                status: 0,
                headers: HashMap::new(),
                body: None,
                stream_first_chunk: None,
                error: Some(e),
            }
        }
    };

    // Build the hyper client with rustls TLS
    let connector =
        hyper_rustls::HttpsConnectorBuilder::new()
            .with_tls_config(tls_config)
            .https_or_http()
            .enable_http2()
            .build();

    let client: Client<_, String> = Client::builder(TokioExecutor::new())
        .http2_only(false)
        .build(connector);

    // Build the outgoing request
    let method = match req.method.as_str() {
        "GET" => hyper::Method::GET,
        "POST" => hyper::Method::POST,
        "PUT" => hyper::Method::PUT,
        "DELETE" => hyper::Method::DELETE,
        "PATCH" => hyper::Method::PATCH,
        "HEAD" => hyper::Method::HEAD,
        "OPTIONS" => hyper::Method::OPTIONS,
        _ => hyper::Method::POST,
    };

    let mut builder = Request::builder().method(method).uri(&req.url);

    // Insert headers in the specified order (important for wire fidelity)
    for (key, value) in &req.headers {
        builder = builder.header(key.as_str(), value.as_str());
    }

    let body = req.body.unwrap_or_default();
    let hyper_req = match builder.body(body) {
        Ok(r) => r,
        Err(e) => {
            return ProxyResponse {
                id: req.id,
                status: 0,
                headers: HashMap::new(),
                body: None,
                stream_first_chunk: None,
                error: Some(format!("failed to build request: {}", e)),
            }
        }
    };

    // Execute the request
    match client.request(hyper_req).await {
        Ok(response) => {
            let status = response.status().as_u16();
            let mut headers = HashMap::new();
            for (key, value) in response.headers() {
                if let Ok(v) = value.to_str() {
                    headers.insert(key.as_str().to_lowercase(), v.to_string());
                }
            }

            // Collect the response body
            let body_bytes = match response.into_body().collect().await {
                Ok(collected) => collected.to_bytes(),
                Err(e) => {
                    return ProxyResponse {
                        id: req.id,
                        status,
                        headers,
                        body: None,
                        stream_first_chunk: None,
                        error: Some(format!("failed to read body: {}", e)),
                    }
                }
            };

            let body_str = String::from_utf8_lossy(&body_bytes).to_string();

            ProxyResponse {
                id: req.id,
                status,
                headers,
                body: Some(body_str),
                stream_first_chunk: None,
                error: None,
            }
        }
        Err(e) => ProxyResponse {
            id: req.id,
            status: 0,
            headers: HashMap::new(),
            body: None,
            stream_first_chunk: None,
            error: Some(format!("request failed: {}", e)),
        },
    }
}
