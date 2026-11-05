import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Message, MessageSchema } from '../messages/message.schema';
import { Announcement, AnnouncementSchema } from './announcement.schema';
import { Group, GroupSchema } from './group.schema';
import { GroupsGateway } from './groups.gateway';
import { GroupsService } from './groups.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Group.name, schema: GroupSchema },
      { name: Announcement.name, schema: AnnouncementSchema },
      // Deleting a Group deletes its Messages.
      { name: Message.name, schema: MessageSchema },
    ]),
  ],
  providers: [GroupsGateway, GroupsService],
  // Group Messages (#11) need to check membership, and a Room's history needs its Announcements.
  exports: [GroupsService],
})
export class GroupsModule {}
