import { createAppHealthClient } from "@saas-maker/app-health";
import { honoMiddleware } from "@saas-maker/app-health/hono";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

describe("App Health endpoint middleware", () => {
  it("records matched route templates without request values and does not await delivery", async () => {
    const fetchPayloads: string[] = [];
    let finishDelivery: ((response: Response) => void) | undefined;
    const client = createAppHealthClient({
      key: "test-ingest-key",
      environment: "test",
      endpoint: "https://ingest.sassmaker.com/v1/ingest",
      runtime: "worker",
      disableTimer: true,
      fetch: async (_input, init) => {
        fetchPayloads.push(String(init?.body));
        return await new Promise<Response>((resolve) => {
          finishDelivery = resolve;
        });
      },
    });
    const recorded: Array<Record<string, unknown>> = [];
    const app = new Hono();
    app.use(
      "*",
      honoMiddleware({
        client,
        release: "issue-pages-0.1.0",
        onRecord: (event) => recorded.push(event),
      }),
    );
    app.get("/articles/:issueNumber/:slug", (c) => c.text("article", 203));

    const response = await app.request("/articles/731/private-title?token=query-secret", {
      headers: { cookie: "session=cookie-secret", authorization: "Bearer header-secret" },
    });

    expect(response.status).toBe(203);
    expect(await response.text()).toBe("article");
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      method: "GET",
      route: "/articles/:issueNumber/:slug",
      status_code: 203,
    });

    const flush = client.flush();
    expect(fetchPayloads).toHaveLength(1);
    const payload = fetchPayloads.join("");
    const batch = JSON.parse(payload) as {
      environment: string;
      release: string;
      events: Array<Record<string, unknown>>;
    };
    expect(batch.environment).toBe("test");
    expect(batch.events[0]).toMatchObject({
      method: "GET",
      route: "/articles/:issueNumber/:slug",
      status_code: 203,
      release: "issue-pages-0.1.0",
    });
    expect(payload).not.toContain("731");
    expect(payload).not.toContain("private-title");
    expect(payload).not.toContain("query-secret");
    expect(payload).not.toContain("cookie-secret");
    expect(payload).not.toContain("header-secret");

    finishDelivery?.(Response.json({ accepted: 1 }));
    await flush;
  });

  it("leaves responses unchanged when endpoint collection is disabled", async () => {
    const app = new Hono();
    app.use("*", honoMiddleware({ client: () => null }));
    app.get("/healthz", (c) => c.json({ ok: true }, 200));

    const response = await app.request("/healthz");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});
