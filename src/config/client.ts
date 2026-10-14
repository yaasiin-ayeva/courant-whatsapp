/**
 * whatsapp-web.js client configuration. LocalAuth persists the session on disk
 * (scan the QR once), and the Chromium flags are a hardened, low-footprint set
 * for running headless in a container.
 */
import pkg from 'whatsapp-web.js'
import { env } from './env'

const { LocalAuth } = pkg

const CHROMIUM_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-accelerated-2d-canvas',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-default-apps',
  '--disable-sync',
  '--disable-translate',
  '--disable-component-update',
  '--disable-client-side-phishing-detection',
  '--disable-popup-blocking',
  '--hide-scrollbars',
  '--metrics-recording-only',
  '--mute-audio',
  '--no-first-run',
  '--no-default-browser-check',
  '--no-pings',
  '--no-zygote',
  '--password-store=basic',
  '--use-mock-keychain',
  '--safebrowsing-disable-auto-update',
]

export function buildClientConfig(clientId: string) {
  return {
    authStrategy: new LocalAuth({ clientId, dataPath: env.sessionDir }),
    puppeteer: {
      headless: true,
      executablePath: env.chromiumPath,
      args: CHROMIUM_ARGS,
    },
    // Keep the pinned WA Web build resilient to minor upstream changes.
    takeoverOnConflict: true,
  }
}
