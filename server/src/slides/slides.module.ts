import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Slide, SlideSchema } from './slide.schema';
import { SlidesService } from './slides.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: Slide.name, schema: SlideSchema }])],
  providers: [SlidesService],
  exports: [SlidesService],
})
export class SlidesModule {}
