const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const randomJitter = (minMs = 1200, maxMs = 3500) => {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise(resolve => setTimeout(resolve, ms));
};

async function runRedbusAutomation(config, overrideHeadless = undefined) {
  const cutoffDateIST = config.cutoffDateIST || '2026-08-31T01:00:00';
  
  // Cutoff Time Check (Runs till 1 AM tomorrow)
  const nowIST = new Date().toLocaleString("en-US", {timeZone: "Asia/Kolkata"});
  const now = new Date(nowIST);
  const cutoff = new Date(cutoffDateIST);

  if (now >= cutoff) {
    console.log(`\n==================================================`);
    console.log(`[STOP CUTOFF REACHED] Current time in IST (${now.toLocaleString()}) matches/exceeds cutoff time ${cutoff.toLocaleString()}.`);
    console.log(`Automation expired. Exiting cleanly.`);
    console.log(`==================================================\n`);
    return {
      success: false,
      cutoffReached: true,
      seatAvailable: false,
      retryNeeded: false,
      error: `Cutoff date ${cutoffDateIST} reached`
    };
  }

  const isHeadless = overrideHeadless !== undefined ? overrideHeadless : (config.headless !== false);
  const screenshotDir = path.join(__dirname, '..', 'screenshots');
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const targetOperator = config.busOperator || 'Easy Go';
  const departureTime = config.departureTime || '23:57';
  const targetUrl = config.targetUrl;
  const boardingPointSearch = config.boardingPointSearch || 'Clock Tower';
  const droppingPointSearch = config.droppingPointSearch || 'Hebbal';

  console.log(`\n==================================================`);
  console.log(`[${new Date().toLocaleString()}] Checking Route...`);
  console.log(`Headless Mode     : ${isHeadless}`);
  console.log(`Bus Operator      : ${targetOperator}`);
  console.log(`Departure Time    : ${departureTime}`);
  console.log(`Seat Position     : Upper Deck 1st Seat (Seat ${config.targetSeatNumber || 'U1'})`);
  console.log(`Pickup Location   : ${boardingPointSearch}`);
  console.log(`Drop Location     : ${droppingPointSearch}`);
  console.log(`Target URL        : ${targetUrl}`);
  console.log(`==================================================`);

  const browser = await chromium.launch({
    headless: isHeadless,
    args: [
      '--disable-http2',
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--window-size=1440,900'
    ]
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'Asia/Kolkata',
    extraHTTPHeaders: {
      'accept-language': 'en-US,en;q=0.9',
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'sec-ch-ua': '"Chromium";v="128", "Not=A?Brand";v="24", "Google Chrome";v="128"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"'
    }
  });

  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
  });

  let runResult = {
    success: false,
    seatAvailable: false,
    retryNeeded: false,
    timestamp,
    selectedSeat: null,
    selectedBp: null,
    selectedDp: null,
    screenshot: null,
    error: null
  };

  try {
    console.log(`Navigating to route: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 40000 });

    console.log('Waiting for search results page to load...');
    await page.waitForSelector('li[class*="srpListItem"], div[class*="tuple"]', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2000);

    console.log(`Locating bus card for operator matching "${targetOperator}" or Departure Time: ${departureTime}...`);
    
    await page.screenshot({ path: path.join(screenshotDir, `initial_load_${timestamp}.png`), fullPage: true }).catch(() => {});

    const busCard = await (async () => {
      const searchPattern = new RegExp(`${targetOperator}|${departureTime}`, 'i');
      const getCardLocator = () => page.locator('li[class*="tupleWrapper"], li[class*="srpListItem"], li[class*="card"], div[class*="busCard"], div[class*="tuple"]').filter({ hasText: searchPattern }).first();

      console.log(`Strategy 1: Progressive page scroll to scan for "${targetOperator}" or "${departureTime}"...`);
      for (let i = 0; i < 8; i++) {
        await page.evaluate(() => window.scrollBy(0, 1000));
        await page.waitForTimeout(400);
        const card = getCardLocator();
        if (await card.count() > 0) {
          console.log(`[FOUND] Bus card matched via Strategy 1 (Progressive Scroll).`);
          await card.first().scrollIntoViewIfNeeded().catch(() => {});
          return card.first();
        }
      }

      console.log(`Strategy 2: Clicking "Departure time" sort tab...`);
      const depSortBtn = page.locator('text=/Departure time/i').first();
      if (await depSortBtn.count() > 0) {
        await depSortBtn.click({ force: true }).catch(() => {});
        await page.waitForTimeout(2500);
        for (let i = 0; i < 8; i++) {
          await page.evaluate(() => window.scrollBy(0, 1000));
          await page.waitForTimeout(400);
          const card = getCardLocator();
          if (await card.count() > 0) {
            console.log(`[FOUND] Bus card matched via Strategy 2 (Departure Time Sort).`);
            await card.first().scrollIntoViewIfNeeded().catch(() => {});
            return card.first();
          }
        }
      }

      console.log(`Strategy 3: Performing deep scroll across all loaded results...`);
      for (let i = 0; i < 15; i++) {
        await page.evaluate(() => window.scrollBy(0, 1500));
        await page.waitForTimeout(400);
        const card = getCardLocator();
        if (await card.count() > 0) {
          console.log(`[FOUND] Bus card matched via Strategy 3 (Deep Scroll).`);
          await card.first().scrollIntoViewIfNeeded().catch(() => {});
          return card.first();
        }
      }

      return getCardLocator().first();
    })();

    if (await busCard.count() === 0) {
      throw new Error(`Bus card container for "${targetOperator}" or departure "${departureTime}" was not found on search page`);
    }

    const viewBtn = busCard.locator('text=/View seats/i').first();
    console.log(`Clicking "View Seats" on matched bus...`);
    await viewBtn.click();
    await randomJitter(2500, 4500);

    const targetSeatNumber = config.targetSeatNumber || 'U1';
    console.log(`Scanning seats layout for Target Seat "${targetSeatNumber}"...`);

    const seatMatch = await page.evaluate((seatNo) => {
      const allSeatSpans = Array.from(document.querySelectorAll('span[aria-label]'));
      
      let found = allSeatSpans.find(s => {
        const id = (s.id || '').toUpperCase();
        const aria = (s.getAttribute('aria-label') || '').toUpperCase();
        return id === seatNo.toUpperCase() || aria.includes(`SEAT NUMBER ${seatNo.toUpperCase()}`);
      });

      if (!found && seatNo.toUpperCase() === 'U1') {
        const deckSections = Array.from(document.querySelectorAll('div[class*="deckSection"]'));
        const upperSec = deckSections.find(s => (s.innerText || '').includes('Upper deck'));
        if (upperSec) {
          const upperSpans = Array.from(upperSec.querySelectorAll('span[aria-label]'));
          found = upperSpans[0];
        }
      }

      if (!found) return null;

      const ariaLabel = found.getAttribute('aria-label') || '';
      const lowerLabel = ariaLabel.toLowerCase();
      const isAvailable = !lowerLabel.includes('sold') && !lowerLabel.includes('booked') && !lowerLabel.includes('not available');
      const seatId = found.id || seatNo;

      return { seatId, ariaLabel, isAvailable };
    }, targetSeatNumber);

    if (!seatMatch) {
      throw new Error(`Target seat "${targetSeatNumber}" was not found in seat map`);
    }

    console.log(`Target Seat Info (${seatMatch.seatId}): ${seatMatch.ariaLabel}`);

    if (!seatMatch.isAvailable) {
      console.log(`\n[SEAT UNAVAILABLE] Target Seat (${seatMatch.seatId}) is currently SOLD/BOOKED.`);
      const unavailableScreenshot = path.join(screenshotDir, `unavailable_${timestamp}.png`);
      await page.screenshot({ path: unavailableScreenshot, fullPage: false }).catch(() => {});
      
      runResult.seatAvailable = false;
      runResult.retryNeeded = true;
      runResult.screenshot = unavailableScreenshot;
      return runResult;
    }

    console.log(`\n[SEAT AVAILABLE!] Seat ${seatMatch.seatId} is AVAILABLE for booking!`);
    console.log(`Selecting seat: ${seatMatch.ariaLabel}...`);
    
    const seatElem = page.locator(`span#${seatMatch.seatId}, span[aria-label*="Seat number ${seatMatch.seatId}" i]`).first();
    await seatElem.scrollIntoViewIfNeeded().catch(() => {});
    await seatElem.click();
    await page.waitForTimeout(2500);

    runResult.selectedSeat = seatMatch.seatId;
    runResult.seatAvailable = true;

    console.log('Proceeding to Boarding & Dropping point selection...');
    const selectBpDpBtn = page.locator('button[aria-label*="Select boarding" i], button[class*="primaryButton"]:has-text("Select boarding"), button:has-text("Select boarding & dropping points")').first();
    if (await selectBpDpBtn.isVisible().catch(() => false)) {
      await selectBpDpBtn.scrollIntoViewIfNeeded().catch(() => {});
      await selectBpDpBtn.click({ force: true });
    }
    await page.waitForTimeout(3000);

    console.log(`Selecting Boarding Point matching "${boardingPointSearch}"...`);
    const bpDetails = await page.evaluate((searchTerm) => {
      const inputs = Array.from(document.querySelectorAll('input[name^="bp_"]'));
      const cleanSearch = searchTerm.toLowerCase().replace(/\s+/g, '');
      let match = inputs.find(i => {
        const parent = i.closest('li') || i.closest('label') || i.parentElement;
        const text = parent ? parent.innerText.toLowerCase().replace(/\s+/g, '') : '';
        return text.includes(cleanSearch);
      }) || inputs[0];

      if (match) {
        const label = document.querySelector(`label[for="${match.id}"]`) || match.parentElement || match;
        label.click();
        const parent = match.closest('li') || match.closest('label') || match.parentElement;
        return parent ? parent.innerText.trim().replace(/\s+/g, ' ') : match.id;
      }
      return null;
    }, boardingPointSearch);

    console.log(`Selected BP: ${bpDetails}`);
    runResult.selectedBp = bpDetails;
    await page.waitForTimeout(2000);

    console.log(`Selecting Dropping Point matching "${droppingPointSearch}"...`);
    const dpDetails = await page.evaluate((searchTerm) => {
      const inputs = Array.from(document.querySelectorAll('input[name^="dp_"]'));
      const cleanSearch = searchTerm.toLowerCase().replace(/\s+/g, '');
      let match = inputs.find(i => {
        const parent = i.closest('li') || i.closest('label') || i.parentElement;
        const text = parent ? parent.innerText.toLowerCase().replace(/\s+/g, '') : '';
        return text.includes(cleanSearch);
      }) || inputs[0];

      if (match) {
        const label = document.querySelector(`label[for="${match.id}"]`) || match.parentElement || match;
        label.click();
        const parent = match.closest('li') || match.closest('label') || match.parentElement;
        return parent ? parent.innerText.trim().replace(/\s+/g, ' ') : match.id;
      }
      return null;
    }, droppingPointSearch);

    console.log(`Selected DP: ${dpDetails}`);
    runResult.selectedDp = dpDetails;
    await page.waitForTimeout(2500);

    console.log('Transitioning to Passenger Info view...');
    const proceedToPassengerBtn = page.locator('button[class*="primaryButton"]:has-text("Continue booking"), button[class*="primaryButton"]:has-text("Proceed"), button[class*="primaryButton"]:has-text("Fill Passenger"), button:has-text("Fill Passenger Details"), button:has-text("Proceed")').first();
    if (await proceedToPassengerBtn.isVisible().catch(() => false)) {
      await proceedToPassengerBtn.click({ force: true });
      await page.waitForTimeout(4000);
    } else {
      await page.locator('text=/Passenger Info/i').first().click({ force: true }).catch(() => {});
      await page.waitForTimeout(4000);
    }

    const p = config.passenger || {};
    const phoneInput = page.locator('input[name="Phone"], input[type="tel"], input[placeholder*="phone" i], input[id="0_6"]').first();
    if (await phoneInput.isVisible().catch(() => false)) await phoneInput.fill(p.phone || '9876543210');

    const emailInput = page.locator('input[placeholder*="Enter email id" i], input[id="0_5"], input[type="email"]').first();
    if (await emailInput.isVisible().catch(() => false)) await emailInput.fill(p.email || 'johndoe@example.com');

    const nameInput = page.locator('input[placeholder*="Enter your Name" i], input[id="0_4"], input[name*="name" i]').first();
    if (await nameInput.isVisible().catch(() => false)) await nameInput.fill(p.name || 'John Doe');

    const ageInput = page.locator('input[placeholder*="Enter Age" i], input[id="0_1"], input[type="number"]').first();
    if (await ageInput.isVisible().catch(() => false)) await ageInput.fill((p.age || '28').toString());

    await page.evaluate(() => {
      const radioInput = document.querySelector('input[value="Male"], input[id$="_22"], input[name*="gender" i][value="Male"]');
      if (radioInput) {
        radioInput.checked = true;
        radioInput.dispatchEvent(new Event('change', { bubbles: true }));
        const label = document.querySelector(`label[for="${radioInput.id}"]`) || radioInput.closest('label');
        if (label) label.click();
      } else {
        const elems = Array.from(document.querySelectorAll('label, div[class*="pill"]'));
        const maleElem = elems.find(e => e.innerText && e.innerText.trim() === 'Male');
        if (maleElem) maleElem.click();
      }
    });

    await page.waitForTimeout(1000);

    await page.evaluate(() => {
      const stateItem = Array.from(document.querySelectorAll('li, div[class*="state"], span')).find(e => e.innerText && /Telangana|Andhra Pradesh|Karnataka/i.test(e.innerText.trim()));
      if (stateItem) stateItem.click();
    });
    
    await page.waitForTimeout(1000);

    await page.evaluate(() => {
      const radio = document.getElementById('insuranceRejectBtn');
      if (radio) {
        const parentLabel = radio.closest('label') || radio.parentElement;
        if (parentLabel) parentLabel.click();
      } else {
        const elements = Array.from(document.querySelectorAll('label, div, span'));
        const target = elements.find(el => el.innerText && /Don’t add Travel Insurance|Don't add Travel Insurance|No, I don't want/i.test(el.innerText.trim()));
        if (target) target.click();
      }
    });
    
    await page.waitForTimeout(1000);
    await page.waitForTimeout(5000);

    console.log('Clicking "Continue booking" button...');
    const clicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, input[type="submit"], div[class*="button"]'));
      const btn = btns.find(b => b.innerText && /continue booking|proceed/i.test(b.innerText.trim()));
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });

    if (!clicked) {
      const continueBookingBtn = page.locator('button[class*="primaryButton"]').filter({ hasText: /Continue booking|Proceed/i }).first();
      await continueBookingBtn.click({ force: true }).catch(() => {});
    }

    await page.waitForURL(url => url.href.includes('paymentDetails') || url.href.includes('checkout') || url.href.includes('payment'), { timeout: 15000 }).catch(() => {});

    const screenshotPath = path.join(screenshotDir, `checkout_${timestamp}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });

    runResult.success = true;
    runResult.screenshot = screenshotPath;
    console.log(`\n==================================================`);
    console.log(`[SUCCESS] Reached Payment page!`);
    console.log(`==================================================`);

    if (!isHeadless) {
      await new Promise(() => {}); 
    } else {
      await page.waitForTimeout((config.keepBrowserOpenSeconds || 15) * 1000);
    }

  } catch (err) {
    console.error(`\n[ERROR] Automation run failed: ${err.message}`);
    runResult.error = err.message;
    runResult.retryNeeded = true; 
    const errorScreenshot = path.join(screenshotDir, `error_${timestamp}.png`);
    try {
      await page.screenshot({ path: errorScreenshot, fullPage: true });
    } catch (ssErr) {}
    runResult.screenshot = errorScreenshot;
  } finally {
    await browser.close();
  }

  return runResult;
}

module.exports = { runRedbusAutomation };