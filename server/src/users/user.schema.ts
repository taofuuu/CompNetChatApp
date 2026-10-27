import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/** A registered User. The password is kept only as a bcrypt hash. */
@Schema()
export class User {
  /** The username as first typed, shown in the Online List. */
  @Prop({ required: true })
  username: string;

  /** The username in lowercase, so no two Users share a name ignoring case. */
  @Prop({ required: true, unique: true })
  usernameLower: string;

  @Prop({ required: true })
  passwordHash: string;
}

export const UserSchema = SchemaFactory.createForClass(User);
