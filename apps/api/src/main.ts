// Nạp .env ở thư mục gốc dự án nếu có (Node ≥ 20.12)
try { process.loadEnvFile(require('node:path').resolve(__dirname, '../../../.env')); } catch { /* không có .env */ }
process.env.TZ = process.env.TZ || 'Asia/Ho_Chi_Minh';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  app.setGlobalPrefix('api');
  app.enableCors({ origin: process.env.CORS_ORIGIN?.split(',') ?? true });
  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);
  console.log(`DMP API chạy tại http://localhost:${port}/api`);
}
bootstrap();
