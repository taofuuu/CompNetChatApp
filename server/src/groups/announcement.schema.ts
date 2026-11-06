import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/** An Announcement saved in a Group's Room. Kept apart from Messages, so unsending, bot and unread counts can never meet one. */
@Schema()
export class Announcement {
  /** The id of the Group's Room. */
  @Prop({ required: true, index: true })
  roomId: string;

  @Prop({ required: true })
  text: string;

  /** Stamped by the server's clock. */
  @Prop({ required: true, default: () => new Date() })
  createdAt: Date;
}

export const AnnouncementSchema = SchemaFactory.createForClass(Announcement);
