package main

import (
	"reflect"
	"testing"
)

func TestCCClientHelloCipherSuitesMatchCapturedClaudeCode(t *testing.T) {
	spec, err := ccClientHelloSpec("api.anthropic.com")
	if err != nil {
		t.Fatalf("ccClientHelloSpec returned error: %v", err)
	}

	want := []uint16{
		0x1301, 0x1302, 0x1303,
		0xc02b, 0xc02f, 0xc02c, 0xc030,
		0xcca9, 0xcca8,
		0xc009, 0xc013, 0xc00a, 0xc014,
		0x009c, 0x009d, 0x002f, 0x0035,
	}
	if !reflect.DeepEqual(spec.CipherSuites, want) {
		t.Fatalf("cipher suites mismatch\nwant: %#04x\ngot:  %#04x", want, spec.CipherSuites)
	}
}
