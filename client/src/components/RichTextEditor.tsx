import { useEffect, useRef } from "react";

type RichTextEditorProps = {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  required?: boolean;
};

function ToolbarButton({
  label,
  title,
  onClick,
}: {
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="rich-editor-btn"
      aria-label={title}
    >
      {label}
    </button>
  );
}

export default function RichTextEditor({
  value,
  onChange,
  placeholder = "Skriv beskrivelse...",
  required = false,
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const focusedRef = useRef(false);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    if (!focusedRef.current && editor.innerHTML !== value) {
      editor.innerHTML = value;
    }
  }, [value]);

  function emitChange() {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    onChange(editor.innerHTML);
  }

  function applyCommand(command: string, commandValue?: string) {
    editorRef.current?.focus();
    document.execCommand(command, false, commandValue);
    emitChange();
  }

  function insertLink() {
    const url = window.prompt("Lim inn lenke (https://...)");
    if (!url) {
      return;
    }
    applyCommand("createLink", url.trim());
  }

  function insertImage() {
    const url = window.prompt("Lim inn bilde-URL (https://...)");
    if (!url) {
      return;
    }
    applyCommand("insertImage", url.trim());
  }

  return (
    <div className="rich-editor-shell">
      <div className="rich-editor-toolbar">
        <ToolbarButton label="B" title="Fet" onClick={() => applyCommand("bold")} />
        <ToolbarButton label="I" title="Kursiv" onClick={() => applyCommand("italic")} />
        <ToolbarButton
          label="U"
          title="Understrek"
          onClick={() => applyCommand("underline")}
        />
        <ToolbarButton
          label="• Liste"
          title="Punktliste"
          onClick={() => applyCommand("insertUnorderedList")}
        />
        <ToolbarButton
          label="1. Liste"
          title="Nummerert liste"
          onClick={() => applyCommand("insertOrderedList")}
        />
        <ToolbarButton label="Lenke" title="Sett inn lenke" onClick={insertLink} />
        <ToolbarButton label="Bilde" title="Sett inn bilde" onClick={insertImage} />
        <ToolbarButton
          label="Nullstill"
          title="Fjern formatering"
          onClick={() => applyCommand("removeFormat")}
        />
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-required={required}
        data-placeholder={placeholder}
        className="rich-editor-content"
        onInput={emitChange}
        onBlur={() => {
          focusedRef.current = false;
          emitChange();
        }}
        onFocus={() => {
          focusedRef.current = true;
        }}
      />
    </div>
  );
}
