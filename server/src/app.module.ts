import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GroupsModule } from './groups/groups.module';
import { MessagesModule } from './messages/messages.module';
import { OnlineListModule } from './online-list/online-list.module';

@Module({
  imports: [
    // A factory, so the variable is read when the app boots rather than when this file is imported.
    MongooseModule.forRootAsync({
      useFactory: () => {
        const uri = process.env.MONGODB_URI;
        if (!uri) throw new Error('MONGODB_URI is not set: copy server/.env.example to server/.env and fill it in.');
        return { uri };
      },
    }),
    OnlineListModule,
    GroupsModule,
    MessagesModule,
  ],
})
export class AppModule {}
