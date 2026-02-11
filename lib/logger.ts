import pino, { type Logger } from 'pino';

export const logger: Logger = pino({
  ...(process.env.NODE_ENV === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss.l',
            ignore: 'pid,hostname',
          },
        },
      }
    : {}),
  level: process.env.NODE_ENV === 'development' ? 'debug' : 'info',
});
