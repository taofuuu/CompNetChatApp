import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  // Locally the settings live in server/.env; on a host they are real environment variables.
  if (existsSync('.env')) process.loadEnvFile();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // The built page, served from the same port as the socket connection.
  app.useStaticAssets(join(__dirname, '..', '..', 'client', 'dist'));
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
