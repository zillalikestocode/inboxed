package main

import (
	"strings"
	"testing"
)

func TestSplitQuoted(t *testing.T) {
	cases := []struct{ name, body, text, quoted string }{
		{"no quote", "Hi\n\nThanks", "Hi\n\nThanks", ""},
		{"attribution", "Sounds good.\n\nOn Tue, Maya Chen wrote:\n> See you then", "Sounds good.", "On Tue, Maya Chen wrote:\n> See you then"},
		{"trailing > block", "Yes.\n> Are you coming?\n>\n> Sam", "Yes.", "> Are you coming?\n>\n> Sam"},
		{"interleaved stays text", "> Question one?\nAnswer one.\n> Question two?\nAnswer two.", "> Question one?\nAnswer one.\n> Question two?\nAnswer two.", ""},
		{"outlook marker", "See below.\n\n-----Original Message-----\nFrom: Sam", "See below.", "-----Original Message-----\nFrom: Sam"},
		{"outlook rule", "Done.\n\n" + strings.Repeat("_", 32) + "\nFrom: Sam <sam@x>\nSubject: Hi", "Done.", strings.Repeat("_", 32) + "\nFrom: Sam <sam@x>\nSubject: Hi"},
		{"rule without headers", "A line\n" + strings.Repeat("_", 32) + "\nnot a header", "A line\n" + strings.Repeat("_", 32) + "\nnot a header", ""},
		{"all quoted", "-----Original Message-----\nFrom: Studio North\n\nHi Daniel", "", "-----Original Message-----\nFrom: Studio North\n\nHi Daniel"},
	}
	for _, c := range cases {
		text, quoted := splitQuoted(c.body)
		if text != c.text || quoted != c.quoted {
			t.Errorf("%s: got (%q, %q), want (%q, %q)", c.name, text, quoted, c.text, c.quoted)
		}
	}
}
