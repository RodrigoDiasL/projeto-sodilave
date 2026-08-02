"use client";

import { useEffect } from "react";

const FIELD_SELECTOR = "input, select, textarea";

function hasUsableValue(field: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) {
  if (field instanceof HTMLInputElement) {
    if (["hidden", "submit", "button", "reset", "file", "range"].includes(field.type)) return false;
    if (field.type === "checkbox" || field.type === "radio") return field.checked;
  }
  return field.value.trim() !== "";
}

function refreshField(field: Element) {
  if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement)) return;
  const readOnly = (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) && field.readOnly;
  const excluded = field.disabled || readOnly || field.closest(".no-valid-highlight") !== null;
  const valid = !excluded && hasUsableValue(field) && field.checkValidity();
  field.classList.toggle("field-valid", valid);

  if (field instanceof HTMLInputElement && (field.type === "checkbox" || field.type === "radio")) {
    field.closest("label")?.classList.toggle("field-valid-choice", valid);
  }
}

function refreshAll(root: ParentNode = document) {
  root.querySelectorAll(FIELD_SELECTOR).forEach(refreshField);
}

export function ValidFieldHighlighter() {
  useEffect(() => {
    const onFieldChange = (event: Event) => refreshField(event.target as Element);
    const onInvalid = (event: Event) => refreshField(event.target as Element);

    refreshAll();
    document.addEventListener("input", onFieldChange, true);
    document.addEventListener("change", onFieldChange, true);
    document.addEventListener("invalid", onInvalid, true);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          if (node.matches(FIELD_SELECTOR)) refreshField(node);
          refreshAll(node);
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      document.removeEventListener("input", onFieldChange, true);
      document.removeEventListener("change", onFieldChange, true);
      document.removeEventListener("invalid", onInvalid, true);
      observer.disconnect();
    };
  }, []);

  return null;
}
