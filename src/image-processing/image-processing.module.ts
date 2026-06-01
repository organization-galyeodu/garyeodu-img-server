import { Module } from '@nestjs/common';
import { ImageProcessingService } from './image-processing.service';
import { ImageProcessingController } from './image-processing.controller';
import { ConfigModule } from '@nestjs/config'; // ConfigModule 임포트

@Module({
  imports: [ConfigModule], // ConfigModule을 임포트하여 환경 변수 사용 가능하게 함
  providers: [ImageProcessingService],
  controllers: [ImageProcessingController],
  exports: [ImageProcessingService], // 필요하다면 다른 모듈에서 사용하기 위해 export
})
export class ImageProcessingModule {}
