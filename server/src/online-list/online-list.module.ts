import { Module } from '@nestjs/common';
import { OnlineListGateway } from './online-list.gateway';
import { OnlineListService } from './online-list.service';

@Module({
  providers: [OnlineListGateway, OnlineListService],
})
export class OnlineListModule {}
