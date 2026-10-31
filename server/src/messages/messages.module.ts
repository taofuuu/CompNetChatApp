import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OnlineListModule } from '../online-list/online-list.module';
import { Message, MessageSchema } from './message.schema';
import { MessagesGateway } from './messages.gateway';
import { MessagesService } from './messages.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Message.name, schema: MessageSchema }]),
    OnlineListModule,
  ],
  providers: [MessagesGateway, MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
