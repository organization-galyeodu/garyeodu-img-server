import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ImageProcessingModule } from './image-processing/image-processing.module'; // 이미지 처리 모듈 임포트
import { ConfigModule } from '@nestjs/config'; // 환경 변수 설정을 위한 ConfigModule 임포트
import { NewsModule } from './news/news.module';

@Module({
  imports: [
    ImageProcessingModule,
    ConfigModule.forRoot({
      isGlobal: true, // ConfigModule을 전역으로 사용 가능하게 설정
    }),
    NewsModule,
  ], // 이미지 처리 모듈과 ConfigModule을 임포트
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
