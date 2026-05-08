//! TLS Shim — Unix Domain Socket server for wire-fidelity HTTPS requests.
//!
//! This binary listens on a Unix socket and accepts JSON-encoded HTTP request
//! descriptions, executes them using a TLS stack that matches Codex CLI's
//! fingerprint (tokio-rustls + ring + hyper), and returns the responses.
//!
//! Usage:
//!   tls-shim /tmp/codex-dario-tls-shim.sock

mod proxy;
mod tls;

use proxy::{ProxyRequest, ProxyResponse};
use std::path::PathBuf;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixListener;
use tokio::sync::oneshot;

#[tokio::main]
async fn main() {
    let socket_path = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "/tmp/codex-dario-tls-shim.sock".to_string());

    // Remove stale socket if it exists
    let _ = std::fs::remove_file(&socket_path);

    let listener = match UnixListener::bind(&socket_path) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[tls-shim] Failed to bind socket at {}: {}", socket_path, e);
            std::process::exit(1);
        }
    };

    eprintln!("[tls-shim] Listening on {}", socket_path);

    // Graceful shutdown on SIGTERM / SIGINT
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let socket_path_clone = PathBuf::from(&socket_path);

    tokio::spawn(async move {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to listen for ctrl+c");
        let _ = shutdown_tx.send(());
    });

    let mut shutdown_rx = shutdown_rx;
    loop {
        tokio::select! {
            accept_result = listener.accept() => {
                match accept_result {
                    Ok((stream, _addr)) => {
                        tokio::spawn(handle_connection(stream));
                    }
                    Err(e) => {
                        eprintln!("[tls-shim] Accept error: {}", e);
                    }
                }
            }
            _ = &mut shutdown_rx => {
                eprintln!("[tls-shim] Shutting down...");
                break;
            }
        }
    }

    // Clean up socket on shutdown
    let _ = std::fs::remove_file(&socket_path_clone);
    eprintln!("[tls-shim] Socket cleaned up, exiting");
}

async fn handle_connection(stream: tokio::net::UnixStream) {
    let (reader, mut writer) = stream.into_split();
    let mut reader = BufReader::new(reader);
    let mut line = String::new();

    loop {
        line.clear();
        match reader.read_line(&mut line).await {
            Ok(0) => break, // EOF
            Ok(_) => {}
            Err(e) => {
                eprintln!("[tls-shim] Read error: {}", e);
                break;
            }
        }

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        // Parse the IPC request
        let proxy_req: ProxyRequest = match serde_json::from_str(trimmed) {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[tls-shim] Parse error: {}", e);
                let err_resp = ProxyResponse {
                    id: "unknown".to_string(),
                    status: 0,
                    headers: std::collections::HashMap::new(),
                    body: None,
                    stream_first_chunk: None,
                    error: Some(format!("invalid request JSON: {}", e)),
                };
                let mut out = serde_json::to_string(&err_resp).unwrap_or_default();
                out.push('\n');
                let _ = writer.write_all(out.as_bytes()).await;
                continue;
            }
        };

        let req_id = proxy_req.id.clone();

        // Execute the request through the Codex-matching TLS stack
        let response = proxy::execute_request(proxy_req).await;

        // Send the response back
        let mut out = match serde_json::to_string(&response) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[tls-shim] Serialize error for req {}: {}", req_id, e);
                let err_resp = ProxyResponse {
                    id: req_id,
                    status: 0,
                    headers: std::collections::HashMap::new(),
                    body: None,
                    stream_first_chunk: None,
                    error: Some(format!("response serialization failed: {}", e)),
                };
                serde_json::to_string(&err_resp).unwrap_or_default()
            }
        };
        out.push('\n');

        if let Err(e) = writer.write_all(out.as_bytes()).await {
            eprintln!("[tls-shim] Write error: {}", e);
            break;
        }
    }
}
