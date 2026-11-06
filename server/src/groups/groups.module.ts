import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Message, MessageSchema } from '../messages/message.schema';
import { OnlineListModule } from '../online-list/online-list.module';
import { Announcement, AnnouncementSchema } from './announcement.schema';
import { Group, GroupSchema } from './group.schema';
import { GroupsGateway } from './groups.gateway';
import { GroupsService } from './groups.service';
import { VoteKicksService } from './vote-kicks.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Group.name, schema: GroupSchema },
      { name: Announcement.name, schema: AnnouncementSchema },
      // Deleting a Group deletes its Messages.
      { name: Message.name, schema: MessageSchema },
    ]),
    // Only an offline Member can be kicked, and only Online Members vote in a Vote Kick.
    OnlineListModule,
  ],
  providers: [GroupsGateway, GroupsService, VoteKicksService],
  // Group Messages (#11) need to check membership, and a Room's history needs its Announcements.
  exports: [GroupsService],
})
export class GroupsModule {}
