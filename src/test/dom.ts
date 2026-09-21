import { JSDOM } from "jsdom";

let dom: JSDOM | null = null;

function setGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, {
    value,
    configurable: true,
    writable: true,
  });
}

/** Install a jsdom document/window for rendered React tests. */
export function installDom(): JSDOM {
  if (dom) return dom;

  dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });
  const { window } = dom;

  setGlobal("window", window);
  setGlobal("document", window.document);
  setGlobal("navigator", window.navigator);
  setGlobal("HTMLElement", window.HTMLElement);
  setGlobal("HTMLInputElement", window.HTMLInputElement);
  setGlobal("HTMLButtonElement", window.HTMLButtonElement);
  setGlobal("HTMLFormElement", window.HTMLFormElement);
  setGlobal("Node", window.Node);
  setGlobal("Text", window.Text);
  setGlobal("DocumentFragment", window.DocumentFragment);
  setGlobal("MutationObserver", window.MutationObserver);
  setGlobal("Event", window.Event);
  setGlobal("KeyboardEvent", window.KeyboardEvent);
  setGlobal("MouseEvent", window.MouseEvent);
  setGlobal("getComputedStyle", window.getComputedStyle.bind(window));
  setGlobal(
    "requestAnimationFrame",
    (cb: FrameRequestCallback) =>
      setTimeout(() => cb(Date.now()), 0) as unknown as number,
  );
  setGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));

  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;

  // Node's undici FormData rejects jsdom HTMLFormElement; bridge for React actions.
  const NativeFormData = globalThis.FormData;
  setGlobal(
    "FormData",
    class FormData extends NativeFormData {
      constructor(form?: unknown, submitter?: unknown) {
        if (
          form &&
          typeof form === "object" &&
          "elements" in (form as { elements?: unknown })
        ) {
          super();
          const elements = (form as HTMLFormElement).elements;
          for (let i = 0; i < elements.length; i += 1) {
            const el = elements.item(i) as HTMLInputElement | null;
            if (!el || !el.name || el.disabled) continue;
            if (el.type === "radio" || el.type === "checkbox") {
              if (!(el as HTMLInputElement).checked) continue;
            }
            if (el.type === "submit" || el.type === "button") continue;
            this.append(el.name, el.value);
          }
          if (
            submitter &&
            typeof submitter === "object" &&
            "name" in submitter &&
            (submitter as HTMLButtonElement).name
          ) {
            this.append(
              (submitter as HTMLButtonElement).name,
              (submitter as HTMLButtonElement).value,
            );
          }
          return;
        }
        // Bridge path — form argument is a jsdom HTMLFormElement handled above.
        super();
      }
    },
  );

  return dom;
}

export function resetDomBody(): void {
  if (!dom) return;
  dom.window.document.body.innerHTML = "";
}
