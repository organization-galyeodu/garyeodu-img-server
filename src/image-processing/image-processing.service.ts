import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ImageAnnotatorClient } from '@google-cloud/vision';
import * as sharp from 'sharp';

// --- Constants ---
const SENSITIVE_LABEL_SCORE_THRESHOLD = 0.7;
const BLUR_RADIUS_DEFAULT = 40;
const BLUR_RADIUS_STRONG = 60;
const BLUR_RADIUS_FALLBACK = 20;

// --- Interfaces ---
interface BoundingBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface PersonalInfoDetection {
  위치: BoundingBox | null;
  종류: string;
}

export interface DetectPersonalInfoResult {
  '이미지 파일 개인정보 문제': {
    상태?: '안전' | '오류';
    메시지?: string;
    에러?: string;
    [key: string]: PersonalInfoDetection | string | undefined;
  };
}

interface ProcessImageResult {
  modifiedImageBuffer: Buffer;
  message: string;
}

@Injectable()
export class ImageProcessingService {
  private readonly visionClient: ImageAnnotatorClient;
  private readonly logger = new Logger(ImageProcessingService.name);

  private readonly personalInfoPatterns = {
    ssn: { pattern: /\d{6}[-\s]?\d{7}|\d{13}/, name: '주민등록번호' },
    phone: { pattern: /01[0-9][-\s]?\d{3,4}[-\s]?\d{4}/, name: '전화번호' },
    email: {
      pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
      name: '이메일',
    },
    creditCard: {
      pattern: /\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}/,
      name: '신용카드번호',
    },
    address: {
      pattern:
        /(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주).*(시|군|구).*(동|로|길|읍|면)/,
      name: '주소',
    },
    licenseNumber: { pattern: /\d{2}-\d{2}-\d{6}-\d{2}/, name: '운전면허번호' },
    accountNumber: { pattern: /\d{3}-\d{2}-\d{6}|\d{11,16}/, name: '계좌번호' },
    businessNumber: { pattern: /\d{3}-\d{2}-\d{5}/, name: '사업자등록번호' },
    foreignerNumber: { pattern: /\d{6}[-\s]?\d{7}/, name: '외국인등록번호' },
    carNumber: {
      pattern: /\d{2,3}[가-힣]\s?\d{4}/,
      name: '자동차번호',
    },
  };

  constructor(private configService: ConfigService) {
    const projectId = this.configService.get<string>('GOOGLE_PROJECT_ID');
    const serviceAccountKeyJson = this.configService.get<string>(
      'GOOGLE_SERVICE_ACCOUNT_KEY',
    );

    if (!serviceAccountKeyJson) {
      this.logger.error(
        'GOOGLE_SERVICE_ACCOUNT_KEY 환경 변수가 설���되지 않았습니다.',
      );
      throw new Error(
        'Google Cloud 서비스 계정 키(JSON 문자열)가 환경 변수에 설정되지 않았습니다.',
      );
    }

    try {
      const credentials = JSON.parse(serviceAccountKeyJson);
      this.visionClient = new ImageAnnotatorClient({
        projectId,
        credentials,
      });
      this.logger.log('Google Cloud Vision Client initialized successfully.');
    } catch (e) {
      this.logger.error(
        `Failed to parse GOOGLE_SERVICE_ACCOUNT_KEY: ${e.message}`,
      );
      throw new Error(`Google Cloud 서비스 계정 키 파싱 오류: ${e.message}`);
    }
  }

  private calculateBoundingBox(vertices: any[]): BoundingBox | null {
    if (!vertices || vertices.length === 0) return null;

    const xCoords = vertices.map((v) => v.x || 0);
    const yCoords = vertices.map((v) => v.y || 0);

    return {
      left: Math.min(...xCoords),
      top: Math.min(...yCoords),
      width: Math.max(...xCoords) - Math.min(...xCoords),
      height: Math.max(...yCoords) - Math.min(...yCoords),
    };
  }

  async detectPersonalInfo(
    imageBuffer: Buffer,
  ): Promise<DetectPersonalInfoResult> {
    try {
      const [textDetections, faceDetections, labelDetections] =
        await Promise.all([
          this.visionClient.textDetection(imageBuffer),
          this.visionClient.faceDetection(imageBuffer),
          this.visionClient.labelDetection(imageBuffer),
        ]);

      const detections: PersonalInfoDetection[] = [];

      // Text-based detections
      const textAnnotations = textDetections[0].textAnnotations;
      if (textAnnotations && textAnnotations.length > 0) {
        textAnnotations.slice(1).forEach((annotation) => {
          const text = annotation.description?.trim();
          if (!text) return;
          Object.values(this.personalInfoPatterns).forEach((patternObj) => {
            if (patternObj.pattern.test(text)) {
              detections.push({
                위치: this.calculateBoundingBox(
                  annotation.boundingPoly?.vertices,
                ),
                종류: patternObj.name,
              });
            }
          });
        });
      }

      // Face detections
      const faces = faceDetections[0].faceAnnotations;
      if (faces) {
        faces.forEach((face) => {
          detections.push({
            위치: this.calculateBoundingBox(face.boundingPoly?.vertices),
            종류: '얼굴',
          });
        });
      }

      // Sensitive document labels
      const labels = labelDetections[0].labelAnnotations;
      const sensitiveLabels = [
        'Document',
        'Identity document',
        'License',
        'Card',
        'Passport',
        'Driver license',
        'ID card',
        'Certificate',
        'Official document',
        'Government document',
      ];
      if (labels) {
        labels.forEach((label) => {
          const isSensitive = sensitiveLabels.some((sensitive) =>
            label.description?.toLowerCase().includes(sensitive.toLowerCase()),
          );
          if (
            isSensitive &&
            (label.score || 0) > SENSITIVE_LABEL_SCORE_THRESHOLD
          ) {
            detections.push({ 위치: null, 종류: '민감문서' });
          }
        });
      }

      // Format results
      const result: DetectPersonalInfoResult = {
        '이미지 파일 개인정보 문제': {},
      };
      const uniqueDetections = [
        ...new Map(
          detections.map((item) => [JSON.stringify(item), item]),
        ).values(),
      ];

      if (uniqueDetections.length > 0) {
        uniqueDetections.forEach((item, index) => {
          result['이미지 파일 개인정보 문제'][(index + 1).toString()] = item;
        });
      } else {
        result['이미지 파일 개인정보 문제'] = {
          상태: '안전',
          메시지: '개인정보가 감지되지 않았습니다.',
        };
      }

      return result;
    } catch (error) {
      this.logger.error('개인정보 감지 에러:', error.message, error.stack);
      let errorMessage = '알 수 없는 오류가 발생했습니다.';
      if (error.code) {
        switch (error.code) {
          case 'ENOENT':
            errorMessage = '이미지 파일을 찾을 수 없습니다.';
            break;
          case 'QUOTA_EXCEEDED':
            errorMessage = 'API 사용량 한도를 초과했습니다.';
            break;
          case 'INVALID_ARGUMENT':
            errorMessage = '잘못된 이미지 형식입니다.';
            break;
          default:
            errorMessage = `API 오류 (코드: ${error.code})`;
        }
      }
      return {
        '이미지 파일 개인정보 문제': { 에러: errorMessage, 상태: '오류' },
      };
    }
  }

  async processImageForPrivacy(input: {
    imageBuffer: Buffer;
    method: 'blur' | 'ai_correction';
    left: number;
    top: number;
    width: number;
    height: number;
    kind: string;
  }): Promise<ProcessImageResult> {
    const { imageBuffer, method, kind } = input;
    const region = {
      left: Number(input.left),
      top: Number(input.top),
      width: Number(input.width),
      height: Number(input.height),
    };

    this.logger.log(
      `[Service] Processing image with method: ${method}, region: ${JSON.stringify(region)}, kind: ${kind}`,
    );

    if (!imageBuffer)
      throw new Error('이미지 파일(Buffer)이 제공되지 않았습니다.');
    if (
      isNaN(region.width) ||
      region.width <= 0 ||
      isNaN(region.height) ||
      region.height <= 0
    ) {
      throw new Error('유효한 너비와 높이 값이 필요합니다.');
    }
    if (
      isNaN(region.left) ||
      region.left < 0 ||
      isNaN(region.top) ||
      region.top < 0
    ) {
      throw new Error('left, top 좌표는 0 이상이어야 합니다.');
    }

    const metadata = await sharp(imageBuffer).metadata();
    const validatedRegion = this.validateRegion(region, metadata);

    if (!validatedRegion) {
      this.logger.warn(
        `경고: 제공된 바운딩 박스가 유효하지 않아 처리할 수 없습니다. Region: ${JSON.stringify(region)}`,
      );
      return {
        modifiedImageBuffer: imageBuffer,
        message: `경고: 개인정보 종류 '${kind}'에 대한 영역이 유효하지 않아 처리되지 않았습니다.`,
      };
    }

    let modifiedImageBuffer: Buffer;
    if (method === 'blur') {
      modifiedImageBuffer = await this.applyBlur(imageBuffer, validatedRegion);
    } else if (method === 'ai_correction') {
      modifiedImageBuffer = await this.applyAiCorrection(
        imageBuffer,
        validatedRegion,
        kind,
        metadata,
      );
    } else {
      throw new Error(
        "유효하지 않은 수정 방법입니다. 'blur' 또는 'ai_correction'을 사용하세요.",
      );
    }

    return {
      modifiedImageBuffer,
      message: `'${kind}' 개인정��� 영역이 성공적으로 처리되었습니다.`,
    };
  }

  private async applyBlur(
    imageBuffer: Buffer,
    region: BoundingBox,
  ): Promise<Buffer> {
    const blurredRegion = await sharp(imageBuffer)
      .extract(region)
      .blur(BLUR_RADIUS_DEFAULT)
      .toBuffer();

    return sharp(imageBuffer)
      .composite([{ input: blurredRegion, left: region.left, top: region.top }])
      .toBuffer();
  }

  private async applyAiCorrection(
    imageBuffer: Buffer,
    region: BoundingBox,
    kind: string,
    metadata: sharp.Metadata,
  ): Promise<Buffer> {
    this.logger.log(`AI Correction: Modifying '${kind}' area.`);

    try {
      // For AI correction, we re-detect specific items in the given region for precision.
      const detections = await this.findDetectionsInRegion(
        imageBuffer,
        region,
        kind,
      );

      if (detections.length > 0) {
        let currentImage = sharp(imageBuffer);
        for (const detection of detections) {
          if (!detection.위치) continue;
          const validatedBox = this.validateRegion(detection.위치, metadata);
          if (!validatedBox) continue;

          const processedRegion = await this.getProcessedRegion(
            imageBuffer,
            validatedBox,
            detection.종류,
          );
          currentImage = currentImage.composite([
            {
              input: processedRegion,
              left: validatedBox.left,
              top: validatedBox.top,
            },
          ]);
        }
        return currentImage.toBuffer();
      } else {
        this.logger.warn(
          `AI Correction: No specific detection found for '${kind}'. Applying default blur.`,
        );
        return this.applyBlur(imageBuffer, region);
      }
    } catch (error) {
      this.logger.error(
        `AI Correction failed: ${error.message}. Falling back to blur.`,
      );
      return this.applyBlur(imageBuffer, region);
    }
  }

  private async findDetectionsInRegion(
    imageBuffer: Buffer,
    region: BoundingBox,
    kind: string,
  ): Promise<PersonalInfoDetection[]> {
    const detections: PersonalInfoDetection[] = [];

    if (kind === '얼굴') {
      const [faceResult] = await this.visionClient.faceDetection(imageBuffer);
      faceResult.faceAnnotations?.forEach((face) => {
        const box = this.calculateBoundingBox(face.boundingPoly?.vertices);
        if (box && this.isOverlap(box, region))
          detections.push({ 위치: box, 종류: '얼굴' });
      });
    } else {
      const [textResult] = await this.visionClient.textDetection(imageBuffer);
      textResult.textAnnotations?.slice(1).forEach((annotation) => {
        const box = this.calculateBoundingBox(
          annotation.boundingPoly?.vertices,
        );
        if (box && this.isOverlap(box, region)) {
          const text = annotation.description?.trim();
          if (!text) return;
          Object.values(this.personalInfoPatterns).forEach((p) => {
            if (p.name === kind && p.pattern.test(text)) {
              detections.push({ 위치: box, 종류: kind });
            }
          });
        }
      });
    }
    return detections;
  }

  private async getProcessedRegion(
    imageBuffer: Buffer,
    region: BoundingBox,
    kind: string,
  ): Promise<Buffer> {
    switch (kind) {
      case '얼굴':
        this.logger.log(`Applying pixelation to '얼굴'.`);
        return sharp(imageBuffer)
          .extract(region)
          .resize(
            Math.max(1, Math.floor(region.width / 10)),
            Math.max(1, Math.floor(region.height / 10)),
            { fit: 'fill' },
          )
          .resize(region.width, region.height, {
            fit: 'fill',
            kernel: 'nearest',
          })
          .toBuffer();
      case '주민등록번호':
      case '전화번호':
      case '이메일':
      case '신용카드번호':
      case '운전면허번호':
      case '계좌번호':
      case '사업자등록번호':
      case '외국인등록번호':
        this.logger.log(
          `Covering sensitive text ('${kind}') with a black box.`,
        );
        return sharp({
          create: {
            width: region.width,
            height: region.height,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 1 },
          },
        })
          .png()
          .toBuffer();
      case '주소':
      case '민감문서':
        this.logger.log(`Applying strong blur to '${kind}'.`);
        return sharp(imageBuffer)
          .extract(region)
          .blur(BLUR_RADIUS_STRONG)
          .toBuffer();
      default:
        this.logger.log(`Applying default blur to '${kind}'.`);
        return sharp(imageBuffer)
          .extract(region)
          .blur(BLUR_RADIUS_FALLBACK)
          .toBuffer();
    }
  }

  async blurImageRegions(
    imageBuffer: Buffer,
    regionsData: any,
  ): Promise<Buffer> {
    const privacyProblems = regionsData['이미지 파일 개인정보 문제'];
    if (!privacyProblems || typeof privacyProblems !== 'object') {
      throw new Error(
        "JSON 데이터에 '이미지 파일 개인정보 문제' 객체가 없습니다.",
      );
    }

    let currentImage = sharp(imageBuffer);
    const metadata = await currentImage.metadata();
    const composites: sharp.OverlayOptions[] = [];

    for (const key in privacyProblems) {
      const item = privacyProblems[key];
      const location = item?.위치;

      if (location) {
        const validatedRegion = this.validateRegion(location, metadata);
        if (validatedRegion) {
          const blurredRegion = await sharp(imageBuffer)
            .extract(validatedRegion)
            .blur(BLUR_RADIUS_DEFAULT)
            .toBuffer();
          composites.push({
            input: blurredRegion,
            left: validatedRegion.left,
            top: validatedRegion.top,
          });
        }
      }
    }

    if (composites.length > 0) {
      currentImage = currentImage.composite(composites);
    }
    return currentImage.toBuffer();
  }

  private validateRegion(
    region: BoundingBox,
    imageMetadata: sharp.Metadata,
  ): BoundingBox | null {
    const { width: imageWidth = 0, height: imageHeight = 0 } = imageMetadata;

    const validated = {
      left: Math.max(0, Math.floor(region.left)),
      top: Math.max(0, Math.floor(region.top)),
      width: Math.floor(region.width),
      height: Math.floor(region.height),
    };

    validated.width = Math.min(validated.width, imageWidth - validated.left);
    validated.height = Math.min(validated.height, imageHeight - validated.top);

    if (validated.width <= 0 || validated.height <= 0) {
      return null;
    }
    return validated;
  }

  private isOverlap(box1: BoundingBox, box2: BoundingBox): boolean {
    return (
      box1.left < box2.left + box2.width &&
      box1.left + box1.width > box2.left &&
      box1.top < box2.top + box2.height &&
      box1.top + box1.height > box2.top
    );
  }
}
