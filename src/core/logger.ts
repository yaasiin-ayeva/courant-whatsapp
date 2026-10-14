import winston from 'winston'
import { env } from '../config/env'

const dev = env.nodeEnv !== 'production'

export const logger = winston.createLogger({
  level: env.logLevel,
  format: dev
    ? winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message, ...rest }) => {
          const extra = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : ''
          return `${timestamp} ${level} ${message}${extra}`
        })
      )
    : winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.Console()],
})
