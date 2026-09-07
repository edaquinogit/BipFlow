import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRouter, createMemoryHistory } from 'vue-router'
import { authRoutes } from '../router/auth.routes'
import { dashboardRoutes } from '../router/dashboard.routes'
import { errorRoutes } from '../router/error.routes'
import { publicRoutes } from '../router/public.routes'
import { systemRoutes } from '../router/system.routes'

const FRONTEND = resolve(__dirname, '..', '..')
const PUBLIC = resolve(FRONTEND, 'public')
const CANONICAL_ORIGIN = 'https://bipflow-manage.pages.dev'

const indexHtml = readFileSync(resolve(FRONTEND, 'index.html'), 'utf8')

// Shared by description / og:description / twitter:description. LinkedIn's
// Post Inspector rejects a card whose description is under 100 characters;
// keep it in the 100..160 range every crawler is happy with.
const SOCIAL_DESCRIPTION =
  'Plataforma SaaS multi-tenant para gestão de lojas, produtos, estoque e pedidos, com vitrine digital, PDV, checkout por WhatsApp e segurança avançada.'

/** width/height from a PNG IHDR chunk (bytes 16..24, big-endian). */
function pngSize(path: string): { width: number; height: number } {
  const buf = readFileSync(path)
  expect(buf.subarray(0, 8).toString('hex'), `${path} is a PNG`).toBe('89504e470d0a1a0a')
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

function meta(html: string, attr: 'property' | 'name', key: string): string | null {
  const m = html.match(
    new RegExp(`<meta[^>]*\\b${attr}=["']${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`, 'i'),
  )
  if (!m) return null
  const c = m[0].match(/\bcontent=["']([^"']*)["']/i)
  return c?.[1] ?? null
}

function link(html: string, rel: string, extra = ''): string | null {
  const m = html.match(new RegExp(`<link[^>]*\\brel=["']${rel}["'][^>]*${extra}[^>]*>`, 'i'))
  if (!m) return null
  const h = m[0].match(/\bhref=["']([^"']*)["']/i)
  return h?.[1] ?? null
}

describe('social metadata — crawler-visible <head> in index.html', () => {
  it('has a BipFlow Manage title and description (no stale store name)', () => {
    const title = indexHtml.match(/<title>([^<]*)<\/title>/i)?.[1] ?? ''
    expect(title).toBe('BipFlow Manage — Gestão multiloja e vitrine digital')
    expect(indexHtml).not.toMatch(/KN Boutique|Boutique Fitness/)
    expect(meta(indexHtml, 'name', 'description')).toBe(SOCIAL_DESCRIPTION)
  })

  it('description / og:description / twitter:description match and are 100..160 chars (LinkedIn ingestion)', () => {
    const description = meta(indexHtml, 'name', 'description') ?? ''
    const ogDescription = meta(indexHtml, 'property', 'og:description') ?? ''
    const twitterDescription = meta(indexHtml, 'name', 'twitter:description') ?? ''

    expect(ogDescription).toBe(description)
    expect(twitterDescription).toBe(description)

    // string spread counts code points, matching how a crawler measures it
    const length = [...description].length
    expect(length, `description is ${length} chars: "${description}"`).toBeGreaterThanOrEqual(100)
    expect(length, `description is ${length} chars: "${description}"`).toBeLessThanOrEqual(160)
  })

  it('sets lang and a zoom-safe viewport (WCAG 1.4.4)', () => {
    expect(indexHtml).toMatch(/<html[^>]*\blang=["']pt-BR["']/i)
    const viewport = meta(indexHtml, 'name', 'viewport') ?? ''
    expect(viewport).not.toMatch(/maximum-scale|user-scalable\s*=\s*no/)
  })

  it('declares every required Open Graph tag with absolute URLs', () => {
    const og = {
      'og:type': 'website',
      'og:site_name': 'BipFlow Manage',
      'og:title': 'BipFlow Manage — Gestão multiloja e vitrine digital',
      'og:description': SOCIAL_DESCRIPTION,
      'og:url': `${CANONICAL_ORIGIN}/`,
      'og:image': `${CANONICAL_ORIGIN}/brand/bipflow-og.png`,
      'og:image:secure_url': `${CANONICAL_ORIGIN}/brand/bipflow-og.png`,
      'og:image:type': 'image/png',
      'og:image:width': '1200',
      'og:image:height': '630',
    }
    for (const [k, v] of Object.entries(og)) {
      expect(meta(indexHtml, 'property', k), k).toBe(v)
    }
    expect(meta(indexHtml, 'property', 'og:image:alt')).toBeTruthy()
    expect(meta(indexHtml, 'property', 'og:url')).toMatch(/^https:\/\//)
    expect(meta(indexHtml, 'property', 'og:image')).toMatch(/^https:\/\/.+\.png$/)
  })

  it('declares a summary_large_image Twitter card', () => {
    expect(meta(indexHtml, 'name', 'twitter:card')).toBe('summary_large_image')
    expect(meta(indexHtml, 'name', 'twitter:title')).toBeTruthy()
    expect(meta(indexHtml, 'name', 'twitter:description')).toBe(SOCIAL_DESCRIPTION)
    expect(meta(indexHtml, 'name', 'twitter:image')).toBe(`${CANONICAL_ORIGIN}/brand/bipflow-og.png`)
  })

  it('has a canonical link and official icon set', () => {
    expect(link(indexHtml, 'canonical')).toBe(`${CANONICAL_ORIGIN}/`)
    expect(link(indexHtml, 'apple-touch-icon')).toBe('/brand/apple-touch-icon.png')
    expect(link(indexHtml, 'manifest')).toBe('/site.webmanifest')
    expect(indexHtml).toMatch(/<link[^>]+rel=["']icon["'][^>]+href=["']\/brand\/favicon-32x32\.png["']/i)
    expect(meta(indexHtml, 'name', 'theme-color')).toMatch(/^#[0-9a-fA-F]{6}$/)
  })

  it('never leaks a non-production host or the old logo asset', () => {
    const head = indexHtml.slice(0, indexHtml.indexOf('</head>'))
    expect(head).not.toMatch(/localhost|127\.0\.0\.1|onrender\.com/)
    // preview subdomains look like <hash>.bipflow-manage.pages.dev
    expect(head).not.toMatch(/[0-9a-f]{6,}\.bipflow-manage\.pages\.dev/)
    expect(head).not.toMatch(/brand-logo\.png/)
  })
})

describe('social metadata — asset files exist and match their declarations', () => {
  const required = [
    'robots.txt',
    'site.webmanifest',
    '_headers',
    'favicon.ico',
    'brand/bipflow-og.png',
    'brand/bipflow-logo.png',
    'brand/favicon-16x16.png',
    'brand/favicon-32x32.png',
    'brand/apple-touch-icon.png',
    'brand/icon-192x192.png',
    'brand/icon-512x512.png',
    'brand/icon-512x512-maskable.png',
  ]

  it.each(required)('public/%s exists and is non-empty', (rel) => {
    const p = resolve(PUBLIC, rel)
    expect(existsSync(p), `${rel} missing — run scripts/build-brand-assets.py`).toBe(true)
    expect(statSync(p).size).toBeGreaterThan(0)
  })

  it('og image is 1200x630 PNG under 5 MB', () => {
    const p = resolve(PUBLIC, 'brand/bipflow-og.png')
    if (!existsSync(p)) return // covered by the existence test above
    expect(pngSize(p)).toEqual({ width: 1200, height: 630 })
    expect(statSync(p).size).toBeLessThan(5 * 1024 * 1024)
  })

  it.each([16, 32, 192, 512])('favicon/icon %spx PNG has matching pixel dimensions', (n) => {
    const name = n <= 32 ? `brand/favicon-${n}x${n}.png` : `brand/icon-${n}x${n}.png`
    const p = resolve(PUBLIC, name)
    if (!existsSync(p)) return
    expect(pngSize(p)).toEqual({ width: n, height: n })
  })

  it('site.webmanifest is valid JSON naming BipFlow with 192 & 512 icons', () => {
    const m = JSON.parse(readFileSync(resolve(PUBLIC, 'site.webmanifest'), 'utf8'))
    expect(m.name).toMatch(/BipFlow/)
    const sizes = (m.icons ?? []).map((i: { sizes: string }) => i.sizes)
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']))
    expect(JSON.stringify(m)).not.toMatch(/localhost|127\.0\.0\.1/)
  })

  it('robots.txt is text, opens the storefront + login, closes the admin panel', () => {
    const robots = readFileSync(resolve(PUBLIC, 'robots.txt'), 'utf8')
    expect(robots).not.toMatch(/<!DOCTYPE|<html/i)
    expect(robots).toMatch(/^Allow:\s*\/l\//m)
    expect(robots).toMatch(/^Disallow:\s*\/dashboard\s*$/m)
    // LinkedIn must be able to reach the login pages -> not disallowed
    expect(robots).not.toMatch(/^Disallow:\s*\/login\s*$/m)
    expect(robots).not.toMatch(/^Disallow:\s*\/entrar\s*$/m)
    expect(robots).toMatch(new RegExp(`Sitemap:\\s*${CANONICAL_ORIGIN}/sitemap\\.xml`))
  })

  it('the advertised sitemap.xml actually exists and is real XML', () => {
    const xml = readFileSync(resolve(PUBLIC, 'sitemap.xml'), 'utf8')
    expect(xml).toMatch(/^<\?xml/)
    expect(xml).toMatch(/<urlset\b[^>]*sitemaps\.org/)
    expect(xml).toMatch(new RegExp(`<loc>${CANONICAL_ORIGIN}/</loc>`))
    expect(xml).not.toMatch(/localhost|127\.0\.0\.1/)
  })

  it('_headers keeps the login pages out of search results (noindex, follow)', () => {
    const headers = readFileSync(resolve(PUBLIC, '_headers'), 'utf8')
    for (const route of ['/login', '/entrar']) {
      const block = headers.slice(headers.indexOf(`\n${route}\n`))
      expect(block, `${route} block`).toMatch(/X-Robots-Tag:\s*noindex,\s*follow/i)
    }
  })
})

describe('SPA direct-route access — every shared URL resolves client-side', () => {
  it.each([
    '/',
    '/login',
    '/entrar',
    '/l/default/produtos',
    '/l/default/produtos/algum-produto',
  ])('router resolves %s to a matched route (no 404 component)', (path) => {
    const probe = createRouter({
      history: createMemoryHistory(),
      routes: [
        ...authRoutes,
        ...dashboardRoutes,
        ...errorRoutes,
        ...systemRoutes,
        ...publicRoutes,
      ],
    })
    const resolved = probe.resolve(path)
    expect(resolved.matched.length, path).toBeGreaterThan(0)
    expect(resolved.name, `${path} must not fall through to the catch-all`).not.toBe(
      'error.not-found',
    )
  })
})
