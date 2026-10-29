import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { OnlineListGateway } from './online-list.gateway';
import { OnlineListService } from './online-list.service';

@Module({
  imports: [UsersModule],
  providers: [OnlineListGateway, OnlineListService],
})
export class OnlineListModule {}
