import type { Browser, BrowserContext } from "playwright";
import { chromium, firefox, webkit } from "playwright";

import { env, isTruthyFlag } from "@/lib/env";

type BrowserFactory = () => Promise<Browser>;

const browserFactories: Record<typeof env.PLAYWRIGHT_BROWSER, BrowserFactory> = {
  chromium: () =>
    chromium.launch({
      headless: isTruthyFlag(env.SCRAPER_HEADLESS),
    }),
  firefox: () =>
    firefox.launch({
      headless: isTruthyFlag(env.SCRAPER_HEADLESS),
    }),
  webkit: () =>
    webkit.launch({
      headless: isTruthyFlag(env.SCRAPER_HEADLESS),
    }),
};

const globalForPlaywrightPool = globalThis as unknown as {
  browserPromise?: Promise<Browser>;
};

async function getBrowser() {
  if (!globalForPlaywrightPool.browserPromise) {
    globalForPlaywrightPool.browserPromise = browserFactories[env.PLAYWRIGHT_BROWSER]();
  }

  return globalForPlaywrightPool.browserPromise;
}

export async function withPlaywrightContext<T>(
  callback: (context: BrowserContext) => Promise<T>,
) {
  const browser = await getBrowser();
  const context = await browser.newContext();

  try {
    return await callback(context);
  } finally {
    await context.close();
  }
}

export async function stopPlaywrightPool() {
  if (!globalForPlaywrightPool.browserPromise) {
    return;
  }

  const browser = await globalForPlaywrightPool.browserPromise;
  await browser.close();
  globalForPlaywrightPool.browserPromise = undefined;
}
