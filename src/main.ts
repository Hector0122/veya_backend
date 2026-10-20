import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Railway pone un proxy delante: sin esto `req.ip` es la IP del proxy y
  // todos los usuarios comparten los límites de @Throttle. Un solo salto.
  app.set('trust proxy', 1);

  app.use(helmet());
  // La app RN ignora CORS; esto solo restringe a clientes web. Sin
  // CORS_ORIGIN queda abierto, igual que antes.
  app.enableCors({
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  Logger.log(`Veya API escuchando en http://localhost:${port}`, 'Bootstrap');
}
void bootstrap();
