import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/** A Message sent into a Room and saved in MongoDB. */
@Schema()
export class Message {
  /** The id of the Room this Message belongs to. */
  @Prop({ required: true, index: true })
  roomId: string;

  /** The username of the sender as originally typed. */
  @Prop({ required: true })
  sender: string;

  /** The message text, trimmed and at most 1000 characters. */
  @Prop({ required: true })
  text: string;

  /** Stamped by the server's clock when the Message is received. */
  @Prop({ required: true, default: () => new Date() })
  createdAt: Date;
}

export const MessageSchema = SchemaFactory.createForClass(Message);
