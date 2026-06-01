import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config'; // ConfigService 임포트

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // ConfigService 인스턴스 가져오기
  const configService = app.get(ConfigService); // 추가

  // CORS 설정
  app.enableCors({
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
    origin: true,
  });

  // --- Swagger 설정 시작 ---
  const config = new DocumentBuilder()
    .setTitle('SnapGuard API')
    .setDescription('개인정보 보호를 위한 이미지 처리 API 문서')
    .setVersion('1.0')
    .addTag('image-processing', '이미지 개인정보 감지 및 수정 관련 API')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);
  // --- Swagger 설정 끝 ---

  // 환경 변수에서 포트 가져오기. PORT 환경 변수가 없으면 기본값 3000 사용
  const port = configService.get<number>('PORT', 3000); // 수정

  await app.listen(port);
  // 앱이 어떤 포트에서 실행 중인지 로그 남기기 (선택 사항, 디버깅에 유용)
  Logger.log(`Application is running on: http://localhost:${port}/api`);
}
bootstrap();
