// Utility test: capture the game table screenshot for UI review.
import { test, expect } from "@playwright/test";

test("capture table screenshot", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByPlaceholder("Wastelander").fill("ShotHost");
  await page.getByRole("button", { name: /⚔ Create room/ }).click();
  await page.locator(".room-code .code").waitFor();
  const code = (await page.locator(".room-code .code").textContent())?.trim() ?? "";

  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: /\+ Add bot/ }).click();
  await page.getByRole("button", { name: /▶ Start game/ }).click();
  await page.locator(".offers .card").first().waitFor();
  await page.locator(".offers .card").first().click();
  await page.locator(".me-zone").waitFor({ timeout: 30_000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: "/tmp/ashfall-table.png" });
  console.log("table screenshot saved");
  await expect(page.locator(".me-zone")).toBeVisible();
});
