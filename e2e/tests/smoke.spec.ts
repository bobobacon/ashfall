// E2E smoke (SIT C-01..C-08 core loop): create → join → start → draft → play.
import { test, expect, type Page } from "@playwright/test";

const NAME = "Tester";

async function createRoom(page: Page): Promise<string> {
  await page.goto("/");
  await page.getByPlaceholder("Wastelander").fill(NAME);
  await page.getByRole("button", { name: /⚔ Create room/ }).click();
  // room code appears in the lobby
  const codeBox = page.locator(".room-code .code");
  await expect(codeBox).toBeVisible({ timeout: 10_000 });
  const code = (await codeBox.textContent())?.trim() ?? "";
  expect(code).toMatch(/^[A-Z0-9]{6}$/);
  return code;
}

test("C-01/C-02: create room → lobby shows code; second player joins live", async ({ browser }) => {
  const host = await browser.newPage();
  const code = await createRoom(host);

  const guest = await browser.newPage();
  await guest.goto("/");
  await guest.getByPlaceholder("Wastelander").fill("Guest");
  await guest.locator(".code-input").fill(code);
  await guest.getByRole("button", { name: /^Join$/ }).click();

  // host sees 2 players
  await expect(host.locator(".seat", { hasText: "Guest" })).toBeVisible({ timeout: 10_000 });
  await expect(guest.locator(".seat", { hasText: NAME })).toBeVisible({ timeout: 10_000 });

  await host.close();
  await guest.close();
});

test("C-03: draft offers appear with 3 survivers and picking works", async ({ browser }) => {
  const host = await browser.newPage();
  const code = await createRoom(host);
  // two bots to reach 3 players
  await host.getByRole("button", { name: /\+ Add bot/ }).click();
  await host.getByRole("button", { name: /\+ Add bot/ }).click();
  await expect(host.locator(".seat")).toHaveCount(3);
  await host.getByRole("button", { name: /▶ Start game/ }).click();

  // draft screen: offer cards — Sovereign sees 6 (3 random + 3 leaders), others 3
  const offerCard = host.locator(".offers .card");
  await expect(offerCard.first()).toBeVisible({ timeout: 15_000 });
  const offerCount = await offerCard.count();
  expect([3, 6]).toContain(offerCount);
  const firstName = (await host.locator(".offers .card .cname").first().textContent()) ?? "";
  expect(firstName.length).toBeGreaterThan(0);

  // pick the first — draft resolves to game table (hand-area visible = in game)
  await host.locator(".offers .card").first().click();
  await expect(host.locator(".hand-area")).toBeVisible({ timeout: 20_000 });
  await expect(host.locator(".feed")).toBeVisible();

  await host.close();
});

test("C-09: disconnect banner during idle (reconnect path)", async ({ browser }) => {
  const host = await browser.newPage();
  const code = await createRoom(host);
  const guest = await browser.newPage();
  await guest.goto("/");
  await guest.getByPlaceholder("Wastelander").fill("G2");
  await guest.locator(".code-input").fill(code);
  await guest.getByRole("button", { name: /^Join$/ }).click();
  await expect(host.locator(".seat", { hasText: "G2" })).toBeVisible();

  // start the game (3 players: host+guest+bot)
  await host.getByRole("button", { name: /\+ Add bot/ }).click();
  await host.getByRole("button", { name: /▶ Start game/ }).click();
  await expect(host.locator(".offers .card").first()).toBeVisible({ timeout: 15_000 });
  await expect(guest.locator(".offers .card").first()).toBeVisible({ timeout: 15_000 });

  // both humans pick → game reaches the table (offline marking is mid-game only)
  await host.locator(".offers .card").first().click();
  await guest.locator(".offers .card").first().click();
  await expect(host.locator(".hand-area")).toBeVisible({ timeout: 20_000 });

  // guest closes connection mid-game; host marks them offline
  await guest.close();
  await expect(host.locator(".seat.offline").first()).toBeVisible({ timeout: 15_000 });

  await host.close();
});

test("C-12: no horizontal scroll on narrow viewport", async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 768, height: 900 } });
  await page.goto("/");
  await page.getByPlaceholder("Wastelander").fill("Small");
  await page.getByRole("button", { name: /⚔ Create room/ }).click();
  await expect(page.locator(".room-code")).toBeVisible({ timeout: 10_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
  await page.close();
});