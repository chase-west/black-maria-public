import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { HighlightStyle, bracketMatching, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { javascript } from "@codemirror/lang-javascript";
import { tags as t } from "@lezer/highlight";
import { PALETTE as P } from "@blackmaria/style";

/** Syntax colors from the palette only. Lilac is Maria's, so code never uses it. */
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.modifier], color: P.teal, fontWeight: "700" },
  { tag: [t.string, t.special(t.string), t.regexp], color: P.coral },
  { tag: [t.number, t.bool, t.null, t.atom], color: P.coral, fontWeight: "700" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: P.moss, fontStyle: "italic" },
  { tag: [t.definition(t.variableName), t.function(t.variableName), t.definition(t.propertyName), t.className], color: P.cocoa, fontWeight: "700" },
  { tag: [t.propertyName, t.variableName, t.operator, t.punctuation, t.bracket], color: P.cocoa },
]);

const theme = EditorView.theme({
  "&": { backgroundColor: P.cream, color: P.cocoa, height: "100%", fontSize: "14px" },
  ".cm-content": { fontFamily: "'Space Mono', monospace", caretColor: P.coral },
  ".cm-scroller": { fontFamily: "'Space Mono', monospace", lineHeight: "1.55" },
  ".cm-gutters": { backgroundColor: P.cream, color: P.teal, borderRight: `3px solid ${P.cocoa}` },
  ".cm-activeLine": { backgroundColor: "transparent", outline: `2px dashed ${P.mustard}`, outlineOffset: "-2px" },
  ".cm-activeLineGutter": { backgroundColor: P.mustard, color: P.cocoa },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: P.coral, borderLeftWidth: "3px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: `${P.mustard} !important` },
  ".cm-matchingBracket": { backgroundColor: P.moss, color: P.cocoa },
  "&.cm-focused": { outline: "none" },
});

export function createEditor(parent: HTMLElement, doc: string, onChange: (code: string) => void): EditorView {
  return new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        history(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        javascript(),
        syntaxHighlighting(highlight),
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
        theme,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChange(u.state.doc.toString());
        }),
      ],
    }),
  });
}
