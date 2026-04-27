"use client";

import { Bot, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type MetaConnectButtonProps = {
  className?: string;
};

type MetaPopupMessage = {
  message?: string;
  status?: "connected" | "error" | "select-page";
  type?: string;
};

const POPUP_NAME = "the-book-meta-connect";

function buildPopupFeatures() {
  const width = 620;
  const height = 760;
  const left = Math.max(window.screenX + (window.outerWidth - width) / 2, 0);
  const top = Math.max(window.screenY + (window.outerHeight - height) / 2, 0);

  return [
    "popup=yes",
    `width=${width}`,
    `height=${height}`,
    `left=${Math.round(left)}`,
    `top=${Math.round(top)}`,
    "resizable=yes",
    "scrollbars=yes",
  ].join(",");
}

export function MetaConnectButton({ className = "" }: MetaConnectButtonProps) {
  const router = useRouter();
  const [isOpening, setIsOpening] = useState(false);

  useEffect(() => {
    function handleMessage(event: MessageEvent<MetaPopupMessage>) {
      if (event.origin !== window.location.origin) {
        return;
      }

      if (event.data?.type !== "the-book-meta-auth") {
        return;
      }

      setIsOpening(false);

      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.delete("messagingError");
      nextUrl.searchParams.delete("messagingStatus");

      if (event.data.status === "error" && event.data.message) {
        nextUrl.searchParams.set("messagingError", event.data.message);
      } else if (event.data.status) {
        nextUrl.searchParams.set("messagingStatus", event.data.status);
      }

      const nextPath = nextUrl.searchParams.toString()
        ? `${nextUrl.pathname}?${nextUrl.searchParams.toString()}`
        : nextUrl.pathname;

      router.replace(nextPath, {
        scroll: false,
      });
      router.refresh();
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [router]);

  function openPopup() {
    setIsOpening(true);

    const popup = window.open("/api/admin/meta/connect?mode=popup", POPUP_NAME, buildPopupFeatures());
    if (!popup) {
      setIsOpening(false);

      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set(
        "messagingError",
        "Popup blocked. Please allow popups for this site and try again.",
      );
      const nextPath = nextUrl.searchParams.toString()
        ? `${nextUrl.pathname}?${nextUrl.searchParams.toString()}`
        : nextUrl.pathname;

      router.replace(nextPath, {
        scroll: false,
      });
      return;
    }

    popup.focus();

    const popupWatcher = window.setInterval(() => {
      if (!popup.closed) {
        return;
      }

      window.clearInterval(popupWatcher);
      setIsOpening(false);
    }, 500);
  }

  return (
    <button
      className={`inline-flex items-center gap-2 rounded-full bg-[var(--foreground)] px-5 py-3 text-sm font-semibold text-white transition hover:opacity-92 disabled:cursor-not-allowed disabled:opacity-65 ${className}`.trim()}
      disabled={isOpening}
      onClick={openPopup}
      type="button"
    >
      {isOpening ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
      {isOpening ? "Opening Facebook Login..." : "Continue to Facebook Login"}
    </button>
  );
}
