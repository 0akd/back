import { Hono } from 'hono'
import * as cheerio from 'cheerio'
import puppeteer from 'puppeteer'
const scraper = new Hono()
interface ScrapeResult {
url: string
title: string
text: string
links: Array<{ href: string; text: string }>
html: string
timestamp: string
error?: string
cleanText?: string
metaDescription?: string
wordCount?: number
headings?: string[]
opportunities?: any[]
rawLinks?: Array<{ href: string; text: string }>
}
const userAgents = [
'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36 Edg/127.0.0.0',
'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
]
async function fetchWithRetry(targetUrl: string, headers: Record<string, string>, maxRetries = 4): Promise<Response> {
for (let attempt = 0; attempt < maxRetries; attempt++) {
try {
const res = await fetch(targetUrl, { headers, redirect: 'follow' })
if (res.ok) return res
if ([429, 500, 502, 503, 504].includes(res.status) && attempt < maxRetries - 1) {
const backoff = Math.pow(2, attempt) * 800 + Math.random() * 400
await new Promise(r => setTimeout(r, backoff))
continue
}
throw new Error(`HTTP ${res.status}`)
} catch (e: any) {
if (attempt === maxRetries - 1) throw e
const backoff = Math.pow(2, attempt) * 800 + Math.random() * 400
await new Promise(r => setTimeout(r, backoff))
}
}
throw new Error('Max retries exceeded')
}
let browserInstance: any = null
scraper.post('/', async (c) => {
const { urls } = await c.req.json()
if (!urls || !Array.isArray(urls) || urls.length === 0) {
return c.json({ error: 'Please provide an array of URLs' }, 400)
}
const results: ScrapeResult[] = []
try {
if (!browserInstance) {
try {
browserInstance = await puppeteer.launch({
headless: true,
args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-blink-features=AutomationControlled', '--disable-infobars', '--window-position=0,0', '--ignore-certificate-errors', '--ignore-certificate-errors-spki-list', '--disable-web-security', '--allow-running-insecure-content', '--disable-features=IsolateOrigins,site-per-process', '--disable-site-isolation-trials', '--no-first-run', '--no-default-browser-check', '--disable-default-apps', '--disable-popup-blocking', '--disable-translate', '--disable-background-timer-throttling']
})
} catch {}
}
if (!browserInstance) {
for (let attempt = 0; attempt < 3; attempt++) {
try {
browserInstance = await puppeteer.launch({
headless: true,
args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-blink-features=AutomationControlled', '--disable-infobars', '--window-position=0,0', '--ignore-certificate-errors', '--ignore-certificate-errors-spki-list', '--disable-web-security', '--allow-running-insecure-content', '--disable-features=IsolateOrigins,site-per-process', '--disable-site-isolation-trials', '--no-first-run', '--no-default-browser-check', '--disable-default-apps', '--disable-popup-blocking', '--disable-translate', '--disable-background-timer-throttling', '--disable-accelerated-2d-canvas']
})
break
} catch {
if (attempt === 2) {}
await new Promise(r => setTimeout(r, 1500))
}
}
}
for (const url of urls) {
try {
await new Promise(r => setTimeout(r, 300 + Math.random() * 600))
const headers = {
'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)],
'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
'Accept-Language': 'en-US,en;q=0.9',
'Accept-Encoding': 'gzip, deflate, br',
'Connection': 'keep-alive',
'Upgrade-Insecure-Requests': '1',
'Sec-Fetch-Dest': 'document',
'Sec-Fetch-Mode': 'navigate',
'Sec-Fetch-Site': 'none'
}
let html = ''
let opportunities: any[] = []
let rawLinks: Array<{ href: string; text: string }> = []
if (url.includes('unstop.com') && browserInstance) {
try {
const page = await browserInstance.newPage()
await page.setUserAgent(userAgents[Math.floor(Math.random() * userAgents.length)])
await page.setViewport({ width: 1920 + Math.floor(Math.random() * 120), height: 1080 + Math.floor(Math.random() * 80) })
await page.evaluateOnNewDocument(() => {
Object.defineProperty(navigator, 'webdriver', { get: () => false })
window.navigator.chrome = { runtime: {} }
Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] })
Object.defineProperty(navigator, 'platform', { get: () => 'Win32' })
Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 })
Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 })
Object.defineProperty(navigator, 'pdfViewerEnabled', { get: () => true })
Object.defineProperty(navigator, 'webgl', { get: () => true })
Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] })
Object.defineProperty(navigator, 'cookieEnabled', { get: () => true })
const uad = { brands: [{ brand: "Google Chrome", version: "126" }, { brand: "Chromium", version: "126" }, { brand: "Not;A=Brand", version: "99" }], mobile: false, platform: "Windows", architecture: "x86", bitness: "64", fullVersionList: [] }
Object.defineProperty(navigator, 'userAgentData', { get: () => uad })
const getParameter = WebGLRenderingContext.prototype.getParameter
WebGLRenderingContext.prototype.getParameter = function (parameter) { if (parameter === 37445) return 'Intel Inc.'; if (parameter === 37446) return 'Intel Iris OpenGL Engine'; return getParameter.call(this, parameter) }
})
await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' })
await page.setCookie({ name: 'consent', value: 'accepted', domain: '.unstop.com' })
await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 })
await page.waitForSelector('body', { timeout: 30000 }).catch(() => {})
await new Promise(r => setTimeout(r, 1500 + Math.random() * 1000))
let attempt = 0
const maxAttempts = 3
while (attempt < maxAttempts) {
const content = await page.content()
if (content.includes('Cookies are disabled') || content.includes('enable cookies')) {
await page.reload({ waitUntil: 'networkidle2', timeout: 30000 })
await new Promise(r => setTimeout(r, 1200 + Math.random() * 600))
attempt++
} else {
break
}
}
try {
const acceptBtn = await page.$('button:has-text("Accept"), button[class*="cookie"], button[aria-label*="cookie"], button[id*="cookie"], .cookie-consent button')
if (acceptBtn) await acceptBtn.click().catch(() => {})
} catch {}
await new Promise(r => setTimeout(r, 800 + Math.random() * 400))
for (let i = 0; i < 4; i++) {
await page.mouse.move(100 + Math.random() * 800, 100 + Math.random() * 600)
await new Promise(r => setTimeout(r, 300 + Math.random() * 200))
await page.evaluate(() => window.scrollBy(0, window.innerHeight * (0.5 + Math.random())))
await new Promise(r => setTimeout(r, 400 + Math.random() * 300))
}
for (let i = 0; i < 6; i++) {
await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2.5))
await new Promise(r => setTimeout(r, 700 + Math.random() * 500))
}
opportunities = await page.evaluate(() => {
const items = document.querySelectorAll('div[class*="opp"], div[class*="opportunity"], div[class*="card"], a[href*="/internships/"], a[href*="/internship"], [class*="internship"], [class*="listing"], a[href*="/opp/"]')
return Array.from(items).map(el => {
const parent = el.closest('div') || el
const titleEl = parent.querySelector('h3, h2, [class*="title"], [class*="name"], [class*="heading"]')
const companyEl = parent.querySelector('[class*="company"], [class*="org"], [class*="brand"], [class*="employer"]')
const stipendEl = parent.querySelector('[class*="stipend"], [class*="salary"], [class*="amount"], [class*="pay"]')
const locationEl = parent.querySelector('[class*="location"], [class*="loc"], [class*="place"]')
return {
title: titleEl?.textContent?.trim() || '',
company: companyEl?.textContent?.trim() || '',
stipend: stipendEl?.textContent?.trim() || '',
location: locationEl?.textContent?.trim() || '',
link: (el as HTMLAnchorElement).href || parent.querySelector('a')?.getAttribute('href') || ''
}
}).filter((o: any) => o.title && o.title.length > 3)
})
rawLinks = await page.evaluate(() => {
return Array.from(document.querySelectorAll('a[href]')).map(a => ({
href: (a as HTMLAnchorElement).href,
text: a.textContent?.trim() || ''
})).filter((l: any) => l.href.startsWith('http') && l.text.length > 0).slice(0, 200)
})
html = await page.content()
await page.close()
} catch {
const response = await fetchWithRetry(url, headers)
html = await response.text()
}
} else {
const response = await fetchWithRetry(url, headers)
html = await response.text()
}
const $ = cheerio.load(html)
$('script, style, noscript, nav, footer, header, aside, form, button, .ad, .advertisement, [class*="ad-"], [id*="ad-"], [class*="cookie"], [id*="cookie"], [class*="popup"], [id*="popup"], [class*="banner"], [id*="banner"], [aria-hidden="true"]').remove()
const title = $('title').first().text().trim() || $('h1').first().text().trim() || 'No title found'
const rawText = $('body').text().replace(/\s+/g, ' ').trim()
const cleanText = rawText.slice(0, 250000)
const metaDescription = $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || ''
const wordCount = cleanText.split(/\s+/).filter(Boolean).length
const headings = $('h1, h2, h3').map((_, el) => $(el).text().trim()).get().filter(h => h.length > 3).slice(0, 12)
const baseForLinks = url
const links: Array<{ href: string; text: string }> = []
$('a[href]').each((_, el) => {
let href = $(el).attr('href') || ''
if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) return
try {
const fullHref = new URL(href, baseForLinks).href
if (fullHref.startsWith('http')) {
const linkText = $(el).text().trim() || fullHref
links.push({ href: fullHref, text: linkText })
}
} catch {}
})
const uniqueLinks = Array.from(new Map(links.map(l => [l.href, l])).values()).slice(0, 120)
results.push({
url,
title,
text: cleanText,
links: uniqueLinks,
html: html.slice(0, 180000),
timestamp: new Date().toISOString(),
cleanText,
metaDescription,
wordCount,
headings,
opportunities: opportunities.length > 0 ? opportunities : undefined,
rawLinks: rawLinks.length > 0 ? rawLinks : undefined
})
} catch (error: any) {
results.push({
url,
title: 'Error',
text: '',
links: [],
html: '',
timestamp: new Date().toISOString(),
error: error.message || 'Failed to scrape'
})
}
}
} catch (err: any) {
results.push({
url: 'global',
title: 'Error',
text: '',
links: [],
html: '',
timestamp: new Date().toISOString(),
error: err.message || 'Global scrape failure'
})
}
return c.json({ results })
})
export { scraper }