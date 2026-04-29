import { env } from "@/lib/env";

type MetaPopupPayload = {
  message: string;
  status: "connected" | "error" | "select-page";
};

function buildRedirectUrl(payload: MetaPopupPayload) {
  const url = new URL("/admin/facebook", env.APP_URL);

  if (payload.status === "error") {
    url.searchParams.set("messagingError", payload.message);
  } else {
    url.searchParams.set("messagingStatus", payload.status);
  }

  return url.toString();
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function buildMetaPopupHtml(payload: MetaPopupPayload) {
  const targetOrigin = new URL(env.APP_URL).origin;
  const redirectUrl = buildRedirectUrl(payload);
  const autoClose = payload.status !== "error";
  const title =
    payload.status === "error"
      ? "Facebook connection needs attention"
      : "Finishing your Facebook connection...";
  const detail =
    payload.status === "error"
      ? payload.message
      : "This window will close automatically.";
  const helper =
    payload.status === "error" && payload.message.includes("Meta app credentials are not configured yet.")
      ? "Add your real META_APP_ID and META_APP_SECRET in .env before Facebook can show a login form here."
      : payload.status === "error"
        ? "You can leave this window open while you review the issue, or close it and try again."
        : "Your workspace will refresh as soon as the link is complete.";
  const serializedPayload = JSON.stringify({
    message: payload.message,
    status: payload.status,
    targetOrigin,
    type: "lotpilot-meta-auth",
  });

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>LotPilot | Meta Connection</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root {
        color-scheme: light dark;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
        background:
          radial-gradient(circle at top, rgba(255, 255, 255, 0.1), transparent 24%),
          linear-gradient(180deg, #0b1725 0%, #0e2233 100%);
        color: #f7f1e3;
        font: 16px/1.5 "Segoe UI", sans-serif;
      }
      .card {
        max-width: 460px;
        border: 1px solid rgba(231, 212, 165, 0.28);
        border-radius: 20px;
        background: rgba(10, 18, 24, 0.92);
        padding: 24px;
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.24);
      }
      p {
        margin: 0;
      }
      .title {
        font-size: 20px;
        font-weight: 600;
        letter-spacing: -0.02em;
      }
      .message {
        margin-top: 14px;
        border-radius: 14px;
        padding: 14px 16px;
        background: rgba(255, 255, 255, 0.06);
        color: #f7f1e3;
      }
      .muted {
        margin-top: 10px;
        color: rgba(247, 241, 227, 0.72);
        font-size: 14px;
      }
      .buttonRow {
        display: flex;
        gap: 12px;
        margin-top: 18px;
      }
      .button {
        appearance: none;
        border: 1px solid rgba(231, 212, 165, 0.3);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        color: #f7f1e3;
        cursor: pointer;
        font: inherit;
        padding: 10px 16px;
      }
      .button:hover {
        background: rgba(255, 255, 255, 0.12);
      }
    </style>
  </head>
  <body>
    <div class="card">
      <p class="title">${escapeHtml(title)}</p>
      <p class="message">${escapeHtml(detail)}</p>
      <p class="muted">${escapeHtml(helper)}</p>
      <div class="buttonRow" ${autoClose ? 'style="display:none"' : ""}>
        <button class="button" onclick="window.location.reload()">Try again</button>
        <button class="button" onclick="window.close()">Close window</button>
      </div>
    </div>
    <script>
      (() => {
        const payload = ${serializedPayload};
        const redirectUrl = ${JSON.stringify(redirectUrl)};
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage(payload, payload.targetOrigin);
          }
        } catch {}
        const autoClose = ${autoClose ? "true" : "false"};
        if (!autoClose) {
          return;
        }
        window.close();
        window.location.replace(redirectUrl);
      })();
    </script>
  </body>
</html>`;
}
