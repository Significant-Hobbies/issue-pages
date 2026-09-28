// App Health browser logs for issues.sarthakagrawal.dev. The key is a public,
// origin-pinned log key (not a secret). Logs form submits, [data-log] clicks,
// and client errors to the Logs tab; window.appHealthLog() is available for
// custom events. Built by client:build:log into public/app-health-log.js.

export {};

type Level = "debug" | "info" | "warn" | "error";
type Scalar = string | number | boolean | null | undefined;
interface Options {
  level?: Level;
  title?: string;
  description?: string;
  icon?: string;
  props?: Record<string, Scalar>;
}

const KEY = "ahk_pub_462ad03c764e086016fa4d57d303809fd8c480c06d0f6515";
const ENV = "production";
const ENDPOINT = "https://ingest.sassmaker.com/v1/logs";

function send(event: string, options: Options = {}): void {
  const props: Record<string, Exclude<Scalar, undefined>> = {};
  for (const [key, value] of Object.entries(options.props ?? {})) {
    if (value !== undefined) props[key] = typeof value === "string" ? value.slice(0, 500) : value;
  }
  const body = JSON.stringify({
    public_key: KEY,
    batch_id: crypto.randomUUID(),
    schema_version: "v1",
    environment: ENV,
    logs: [
      {
        log_id: crypto.randomUUID(),
        timestamp: Date.now(),
        event,
        level: options.level ?? "info",
        title: options.title,
        description: options.description,
        icon: options.icon,
        props,
      },
    ],
  });
  if (document.visibilityState === "hidden" && navigator.sendBeacon) {
    navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "text/plain" }));
    return;
  }
  fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body,
    keepalive: true,
  }).catch(() => {
    /* fail open */
  });
}

declare global {
  interface Window {
    appHealthLog: typeof send;
    appHealth?: {
      track: (name: string) => void;
      flush?: () => Promise<unknown> | undefined;
      diagnostics?: () => { queued: number };
    };
  }
}
window.appHealthLog = send;

document.addEventListener(
  "submit",
  (event) => {
    const form = event.target as HTMLFormElement | null;
    if (form?.tagName !== "FORM") return;
    send("form.submitted", {
      title: form.id || form.getAttribute("name") || form.getAttribute("action") || "form",
      props: { page: location.pathname },
    });
  },
  true,
);
document.addEventListener(
  "click",
  (event) => {
    const action = (event.target as Element | null)?.closest("[data-app-health-event]");
    const actionName = action?.getAttribute("data-app-health-event");
    if (actionName && window.appHealth) {
      window.appHealth.track(actionName);
      if (
        action instanceof HTMLAnchorElement &&
        event instanceof MouseEvent &&
        event.button === 0 &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey &&
        action.target !== "_blank" &&
        !action.hasAttribute("download")
      ) {
        event.preventDefault();
        let navigated = false;
        const navigate = () => {
          if (navigated) return;
          navigated = true;
          window.location.assign(action.href);
        };
        window.setTimeout(navigate, 800);
        const tracker = window.appHealth;
        const flushQueued = async () => {
          const deadline = Date.now() + 650;
          do {
            await tracker?.flush?.();
            if (!tracker?.diagnostics?.().queued) return;
            await new Promise((resolve) => window.setTimeout(resolve, 50));
          } while (Date.now() < deadline);
        };
        flushQueued()
          .catch(() => {})
          .finally(navigate);
      }
    }
    const target = (event.target as Element | null)?.closest("[data-log]");
    const name = target?.getAttribute("data-log");
    if (name) {
      send(name, {
        title: target?.textContent?.trim().slice(0, 120) || name,
        props: { page: location.pathname },
      });
    }
  },
  true,
);
window.addEventListener("error", (event) => {
  send("client.error", {
    level: "error",
    title: String(event.message || "error").slice(0, 200),
    props: { page: location.pathname },
  });
});
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason instanceof Error ? event.reason.message : String(event.reason);
  send("client.error", {
    level: "error",
    title: reason.slice(0, 200),
    props: { page: location.pathname, kind: "rejection" },
  });
});
