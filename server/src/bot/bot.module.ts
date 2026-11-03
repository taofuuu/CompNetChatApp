import { Module } from '@nestjs/common';
import { SlidesModule } from '../slides/slides.module';
import { AiClient } from './ai.client';
import { BotService } from './bot.service';

@Module({
  imports: [SlidesModule],
  providers: [AiClient, BotService],
  exports: [BotService],
})
export class BotModule {}
