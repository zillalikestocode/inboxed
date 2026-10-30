package main

import (
	"regexp"
	"strings"
	"unicode"
)

// Same rules as splitQuoted in src/lib/quote.ts; keep the two in step.
var (
	attribution   = regexp.MustCompile(`^On .+ wrote:\s*$`)
	outlookMarker = regexp.MustCompile(`(?i)^-{2,}\s*Original Message\s*-{2,}$`)
	outlookRule   = regexp.MustCompile(`^_{10,}$`) // over a From: line
)

// splitQuoted splits a plain-text body into what the sender wrote and the quoted reply chain below it.
func splitQuoted(body string) (text, quoted string) {
	lines := strings.Split(body, "\n")
	for i, line := range lines {
		if attribution.MatchString(line) || outlookMarker.MatchString(strings.TrimSpace(line)) ||
			(outlookRule.MatchString(strings.TrimSpace(line)) && i+1 < len(lines) && strings.HasPrefix(lines[i+1], "From:")) ||
			(strings.HasPrefix(line, ">") && allQuoted(lines[i:])) {
			return strings.TrimRightFunc(strings.Join(lines[:i], "\n"), unicode.IsSpace), strings.Join(lines[i:], "\n")
		}
	}
	return body, ""
}

func allQuoted(lines []string) bool {
	for _, l := range lines {
		if !strings.HasPrefix(l, ">") && strings.TrimSpace(l) != "" {
			return false
		}
	}
	return true
}

// snippet is the one-line preview a list shows: the new text of a message, never its quoted history.
func snippet(body string) string {
	text, _ := splitQuoted(body)
	if text == "" {
		text = body
	}
	s := strings.Join(strings.Fields(text), " ")
	if r := []rune(s); len(r) > 160 {
		s = string(r[:160])
	}
	return s
}
