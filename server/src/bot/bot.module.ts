import { Module } from '@nestjs/common';
import { AiClient } from './ai.client';
import { BotService } from './bot.service';

@Module({
  providers: [AiClient, BotService],
  exports: [BotService],
})
export class BotModule {}
