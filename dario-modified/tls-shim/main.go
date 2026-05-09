package main

import (
	"context"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"time"

	utls "github.com/refraction-networking/utls"
)

const (
	defaultListenAddr = "127.0.0.1:3443"
	defaultTarget     = "api.anthropic.com:443"
	shimTargetHeader  = "X-Shim-Target-Host"
)

// Allowed upstream hosts — the shim will only dial these.
var allowedTargets = map[string]bool{
	"api.anthropic.com:443":   true,
	"api.anthropic.com":       true,
	"platform.claude.com:443": true,
	"platform.claude.com":     true,
}

func isTargetAllowed(host string) bool {
	if allowedTargets[host] {
		return true
	}
	// Also allow if default target was overridden via env and matches exactly
	if host == envOrDefault("TLS_SHIM_TARGET_HOST", defaultTarget) {
		return true
	}
	return false
}

func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// ccClientHelloSpec builds a ClientHello spec that matches real Claude Code's
// TLS fingerprint. Captured from CC v2.1.137 on Linux x64 (Bun/BoringSSL).
//
// Key difference from default Bun fetch: this spec omits extension 65037
// (Encrypted Client Hello / ECH), which CC does not send but Bun's default
// TLS stack includes.
//
// CC extensions: 0-23-65281-10-11-35-16-5-13-18-51-45-43-21
// CC ciphers:   4865-4866-4867-49195-49199-49196-49200-52393-52392-49161-49171-49162-49172-156-157-47-53
// CC groups:    29-23-24 (X25519, P-256, P-384)
// CC ALPN:      http/1.1
func ccClientHelloSpec(host string) (*utls.ClientHelloSpec, error) {
	return &utls.ClientHelloSpec{
		CipherSuites: []uint16{
			utls.TLS_AES_128_GCM_SHA256,                        // 0x1301
			utls.TLS_AES_256_GCM_SHA384,                        // 0x1302
			utls.TLS_CHACHA20_POLY1305_SHA256,                  // 0x1303
			utls.TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256,       // 0xC02B
			utls.TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256,         // 0xC02F
			utls.TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384,       // 0xC02C
			utls.TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,         // 0xC030
			utls.TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256, // 0xCCA9
			utls.TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256,   // 0xCCA8
			utls.TLS_ECDHE_ECDSA_WITH_AES_128_CBC_SHA,          // 0xC009
			utls.TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA,            // 0xC013
			utls.TLS_ECDHE_ECDSA_WITH_AES_256_CBC_SHA,          // 0xC00A
			utls.TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA,            // 0xC014
			utls.TLS_RSA_WITH_AES_128_GCM_SHA256,               // 0x009C
			utls.TLS_RSA_WITH_AES_256_GCM_SHA384,               // 0x009D
			utls.TLS_RSA_WITH_AES_128_CBC_SHA,                  // 0x002F
			utls.TLS_RSA_WITH_AES_256_CBC_SHA,                  // 0x0035
		},
		CompressionMethods: []byte{0},
		Extensions: []utls.TLSExtension{
			&utls.SNIExtension{ServerName: host},
			&utls.ExtendedMasterSecretExtension{},
			&utls.RenegotiationInfoExtension{},
			&utls.SupportedCurvesExtension{
				Curves: []utls.CurveID{
					utls.X25519,
					utls.CurveP256,
					utls.CurveP384,
				},
			},
			&utls.SupportedPointsExtension{
				SupportedPoints: []byte{0}, // uncompressed
			},
			&utls.SessionTicketExtension{},
			&utls.ALPNExtension{
				AlpnProtocols: []string{"http/1.1"},
			},
			&utls.StatusRequestExtension{},
			&utls.SignatureAlgorithmsExtension{
				SupportedSignatureAlgorithms: []utls.SignatureScheme{
					utls.ECDSAWithP256AndSHA256,
					utls.PSSWithSHA256,
					utls.PKCS1WithSHA256,
					utls.ECDSAWithP384AndSHA384,
					utls.PSSWithSHA384,
					utls.PKCS1WithSHA384,
					utls.PSSWithSHA512,
					utls.PKCS1WithSHA512,
					utls.PKCS1WithSHA1,
				},
			},
			&utls.SCTExtension{},
			&utls.KeyShareExtension{
				KeyShares: []utls.KeyShare{
					{Group: utls.X25519},
				},
			},
			&utls.PSKKeyExchangeModesExtension{
				Modes: []uint8{1}, // PSK with (EC)DHE
			},
			&utls.SupportedVersionsExtension{
				Versions: []uint16{
					utls.VersionTLS13,
					utls.VersionTLS12,
				},
			},
			&utls.UtlsPaddingExtension{GetPaddingLen: utls.BoringPaddingStyle},
		},
	}, nil
}

// dialUTLS establishes a TCP connection to addr and wraps it with utls,
// using CC's ClientHello fingerprint.
func dialUTLS(ctx context.Context, addr string) (net.Conn, error) {
	host := addr
	if h, _, err := net.SplitHostPort(addr); err == nil {
		host = h
	}

	dialer := &net.Dialer{Timeout: 10 * time.Second}
	tcpConn, err := dialer.DialContext(ctx, "tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("tcp dial %s: %w", addr, err)
	}

	spec, err := ccClientHelloSpec(host)
	if err != nil {
		tcpConn.Close()
		return nil, fmt.Errorf("build hello spec: %w", err)
	}

	tlsConn := utls.UClient(tcpConn, &utls.Config{ServerName: host}, utls.HelloCustom)
	if err := tlsConn.ApplyPreset(spec); err != nil {
		tcpConn.Close()
		return nil, fmt.Errorf("apply preset: %w", err)
	}

	if err := tlsConn.HandshakeContext(ctx); err != nil {
		tcpConn.Close()
		return nil, fmt.Errorf("utls handshake: %w", err)
	}

	return tlsConn, nil
}

func main() {
	listenAddr := envOrDefault("TLS_SHIM_LISTEN_ADDR", defaultListenAddr)
	defaultTargetHost := envOrDefault("TLS_SHIM_TARGET_HOST", defaultTarget)

	// Build default target URL for reverse proxy
	defaultTarget, err := url.Parse("https://" + defaultTargetHost)
	if err != nil {
		log.Fatalf("invalid default target %s: %v", defaultTargetHost, err)
	}

	proxy := httputil.NewSingleHostReverseProxy(defaultTarget)

	// Flush immediately for SSE streaming
	proxy.FlushInterval = -1

	// Custom transport with utls dialer — routes to per-request target
	proxy.Transport = &http.Transport{
		DialTLSContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			return dialUTLS(ctx, addr)
		},
		MaxIdleConns:        10,
		MaxIdleConnsPerHost: 10,
		IdleConnTimeout:     90 * time.Second,
	}

	const validatedHeader = "X-Shim-Validated-Target"

	// Director: read the validated target (set by the outer handler) and
	// apply it. Must run AFTER origDirector so our override takes precedence.
	origDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		origDirector(req)

		targetHost := req.Header.Get(validatedHeader)
		req.Header.Del(validatedHeader)
		if targetHost == "" {
			targetHost = defaultTarget.Host
		}

		req.URL.Scheme = "https"
		req.URL.Host = targetHost
		req.Host = targetHost
		req.Header.Set("Host", targetHost)
	}

	// Mux: /healthz is local, everything else goes through the proxy with
	// allowlist enforcement. Target validation happens here, BEFORE the
	// proxy Director runs, so we can reject early with the right status code.
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		// Report the TLS fingerprint the shim is configured to produce,
		// so dario can compare against the latest CC capture.
		w.Write([]byte(`{"status":"ok","tls_fingerprint":{"extensions":"0-23-65281-10-11-35-16-5-13-18-51-45-43-21","cipher_suites":"1301-1302-1303-c02b-c02f-c02c-c030-cca9-cca8-c009-c013-c00a-c014-009c-009d-002f-0035","alpn":"http/1.1","ech_65037":false}}`))
	})
	mux.Handle("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		targetHost := defaultTarget.Host

		if raw := r.Header.Get(shimTargetHeader); raw != "" {
			r.Header.Del(shimTargetHeader)
			t, err := url.Parse("https://" + raw)
			if err != nil {
				log.Printf("invalid %s %q", shimTargetHeader, raw)
				http.Error(w, "tls-shim: invalid target host", http.StatusBadRequest)
				return
			}
			targetHost = t.Host
		}

		if !isTargetAllowed(targetHost) {
			log.Printf("blocked: target %q not in allowlist", targetHost)
			http.Error(w, "tls-shim: target host not allowed", http.StatusForbidden)
			return
		}

		// Pass validated target to Director via private header
		r.Header.Set(validatedHeader, targetHost)
		proxy.ServeHTTP(w, r)
	}))

	// Error handler — pass through upstream error responses
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		log.Printf("proxy error: %v", err)
		http.Error(w, fmt.Sprintf("tls-shim: %v", err), http.StatusBadGateway)
	}

	log.Printf("[tls-shim] Listening on %s, default target %s", listenAddr, defaultTargetHost)
	log.Printf("[tls-shim] Per-request routing via %s header", shimTargetHeader)
	log.Printf("[tls-shim] CC fingerprint: no ECH(65037), 17 ciphers, ALPN http/1.1")

	server := &http.Server{
		Addr:         listenAddr,
		Handler:      mux,
		ReadTimeout:  600 * time.Second,
		WriteTimeout: 600 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	log.Fatal(server.ListenAndServe())
}
