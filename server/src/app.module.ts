import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OnlineListGateway } from './online-list.gateway';

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
  ],
  providers: [OnlineListGateway],
})
export class AppModule {}
