//git test

import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  Body,
  BadRequestException,
  Res,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ImageProcessingService } from './image-processing.service';
import { Response } from 'express';

// Swagger 데코레이터 임포트
import {
  ApiTags,
  ApiOperation,
  ApiConsumes,
  ApiBody,
  ApiResponse,
  ApiProperty,
} from '@nestjs/swagger';

// class-validator 및 class-transformer 임포트
import { IsNumber, IsString, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

// 💡 변경된 부분: ProcessImageDto의 x, y 필드를 left, top으로 변경
export class ProcessImageDto {
  @ApiProperty({
    description: '수정 방법 (blur 또는 ai_correction)',
    enum: ['blur', 'ai_correction'],
    example: 'blur',
  })
  @IsIn(['blur', 'ai_correction'])
  method: 'blur' | 'ai_correction';

  @ApiProperty({
    description: '개인정보 영역의 left 좌표 (x 좌표와 동일)',
    example: 1023,
  })
  @Type(() => Number)
  @IsNumber()
  left: number; // 💡 x 대신 left

  @ApiProperty({
    description: '개인정보 영역의 top 좌표 (y 좌표와 동일)',
    example: 1265,
  })
  @Type(() => Number)
  @IsNumber()
  top: number; // 💡 y 대신 top

  @ApiProperty({
    description: '개인정보 영역의 너비',
    example: 1093,
  })
  @Type(() => Number)
  @IsNumber()
  width: number;

  @ApiProperty({
    description: '개인정보 영역의 높이',
    example: 940,
  })
  @Type(() => Number)
  @IsNumber()
  height: number;

  @ApiProperty({
    description: '개인정보의 종류 (예: 얼굴, 주민등록번호)',
    example: '얼굴',
  })
  @IsString()
  kind: string;
}

@ApiTags('image-processing')
@Controller('image-processing')
export class ImageProcessingController {
  private readonly logger = new Logger(ImageProcessingController.name);

  constructor(
    private readonly imageProcessingService: ImageProcessingService,
  ) {}

  @Post('detect')
  @UseInterceptors(FileInterceptor('image'))
  @ApiOperation({ summary: '이미지에서 개인정보를 감지합니다.' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: '개인정보 감지를 위한 이미지 파일 (JPG, PNG 등)',
    schema: {
      type: 'object',
      properties: {
        image: {
          type: 'string',
          format: 'binary',
        },
      },
      required: ['image'],
    },
  })
  @ApiResponse({
    status: 200,
    description: '개인정보 감지 성공',
    schema: {
      example: {
        '이미지 파일 개인정보 문제': {
          상태: '안전',
          메시지: '개인정보가 감지되지 않았습니다.',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청 또는 파일 없음',
    schema: {
      example: {
        statusCode: 400,
        message: '이미지 파일이 업로드되지 않았습니다.',
        error: 'Bad Request',
      },
    },
  })
  async detectPersonalInfo(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('이미지 파일이 업로드되지 않았습니다.');
    }
    return this.imageProcessingService.detectPersonalInfo(file.buffer);
  }

  @Post('process') // 기존 엔드포인트를 개별 정보 처리용으로 사용
  @UseInterceptors(FileInterceptor('image'))
  @ApiOperation({
    summary: '이미지의 특정 개인정보 영역을 개별 좌표로 수정합니다.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: '이미지 파일과 수정할 개인정보의 개별 위치 및 종류 정보',
    schema: {
      type: 'object',
      properties: {
        image: {
          type: 'string',
          format: 'binary',
          description: '수정할 이미지 파일',
        },
        method: {
          type: 'string',
          enum: ['blur', 'ai_correction'],
          example: 'blur',
          description: '수정 방법 (blur 또는 ai_correction)',
        },
        left: {
          // 💡 x 대신 left
          type: 'number',
          example: 1023,
          description: '수정할 개인정보 영역의 left 좌표',
        },
        top: {
          // 💡 y 대신 top
          type: 'number',
          example: 1265,
          description: '수정할 개인정보 영역의 top 좌표',
        },
        width: {
          type: 'number',
          example: 1093,
          description: '수정할 개인정보 영역의 너비',
        },
        height: {
          type: 'number',
          example: 940,
          description: '수정할 개인정보 영역의 높이',
        },
        kind: {
          type: 'string',
          example: '얼굴',
          description: '수정할 개인정보의 종류 (예: 얼굴, 주민등록번호)',
        },
      },
      // 💡 required 필드도 x, y 대신 left, top으로 변경
      required: ['image', 'method', 'left', 'top', 'width', 'height', 'kind'],
    },
  })
  @ApiResponse({
    status: 200,
    description: '이미지 수정 성공 (수정된 이미지 파일 반환)',
    content: { 'image/jpeg': {} },
  })
  async processImage(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: ProcessImageDto, // 수정된 DTO 사용
    @Res() res: Response,
  ) {
    if (!file) {
      throw new BadRequestException('이미지 파일이 업로드되지 않았습니다.');
    }

    try {
      this.logger.debug(
        `[Controller] Received individual params: ${JSON.stringify(body)}`,
      );

      const result = await this.imageProcessingService.processImageForPrivacy({
        imageBuffer: file.buffer,
        method: body.method,
        left: body.left, // 💡 x 대신 left
        top: body.top, // 💡 y 대신 top
        width: body.width,
        height: body.height,
        kind: body.kind,
      });

      res.set({
        'Content-Type': 'image/jpeg',
        'Content-Disposition': 'attachment; filename="modified_image.jpg"',
      });
      res.send(result.modifiedImageBuffer);
    } catch (error) {
      this.logger.error(
        '이미지 처리 중 오류 발생:',
        error.message,
        error.stack,
      );
      throw new BadRequestException(`이미지 처리 중 오류: ${error.message}`);
    }
  }

  @Post('blur-regions')
  @UseInterceptors(FileInterceptor('image'))
  @ApiOperation({
    summary: 'JSON 데이터에 명시된 여러 이미지 영역을 블러 처리합니다.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: '이미지 파일과 블러 처리할 영역 정보(JSON 문자열)',
    schema: {
      type: 'object',
      properties: {
        image: {
          type: 'string',
          format: 'binary',
        },
        regions: {
          type: 'string',
          description: '블러 처리할 영역 정보가 담긴 JSON 문자열',
          example: JSON.stringify({
            '이미지 파일 개인정보 문제': {
              '1': {
                위치: { left: 496, top: 1783, width: 135, height: 56 },
                종류: '전화번호',
              },
              '2': {
                위치: { left: 515, top: 1887, width: 144, height: 63 },
                종류: '전화번호',
              },
            },
          }),
        },
      },
      required: ['image', 'regions'],
    },
  })
  @ApiResponse({ status: 200, description: '이미지 블러 처리 성공' })
  async blurImageRegions(
    @UploadedFile() file: Express.Multer.File,
    @Body('regions') regionsJson: string,
    @Res() res: Response,
  ) {
    if (!file) {
      throw new BadRequestException('이미지 파일이 업로드되지 않았습니다.');
    }
    if (!regionsJson) {
      throw new BadRequestException(
        '블러 처리할 영역 정보(regions)가 없습니다.',
      );
    }

    try {
      const regionsData = JSON.parse(regionsJson);
      const modifiedImageBuffer =
        await this.imageProcessingService.blurImageRegions(
          file.buffer,
          regionsData,
        );

      res.set({
        'Content-Type': 'image/jpeg',
        'Content-Disposition': 'attachment; filename="blurred_image.jpg"',
      });
      res.send(modifiedImageBuffer);
    } catch (error) {
      this.logger.error(
        '이미지 블러 처리 중 오류 발생:',
        error.message,
        error.stack,
      );
      if (error instanceof SyntaxError) {
        throw new BadRequestException('잘못된 JSON 형식입니다.');
      }
      throw new BadRequestException(`이미지 처리 중 오류: ${error.message}`);
    }
  }
}
