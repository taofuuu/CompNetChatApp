# CompNet Chat App

A socket-programming term project: a multi-user chat application where clients on different computers talk to each other through a central server.

## Language

**Chat App**:
The product: a multi-user application where people send text messages to each other through a central server.
_Avoid_: Chatbot (reserved for a possible AI feature, not the product)

### People

**User**:
A person registered in the Chat App, identified by a username that is unique ignoring case, and protected by a password.
_Avoid_: Account, client name

**Client**:
One running instance of the Chat App's web page on a computer, connected to the server and logged in as one User. A User may have several Clients at once.
_Avoid_: User (a User is the person, a Client is their connection)

**Online**:
A User is Online while at least one of their Clients is connected.
_Avoid_: Connected (that describes a Client, not a User), active

**Online List**:
The names of every Online User, shown to every Client, including the viewer's own name.
_Avoid_: Client list, user list, contacts

### Rooms

**Room**:
A place where Messages are exchanged: either a Private Room or a Group. Each Room has its own history.
_Avoid_: Conversation, channel, thread

**Private Room**:
The single Room shared by exactly two Users, the same no matter which of them opens it. A User has no Private Room with themselves.
_Avoid_: DM thread, direct chat

**Group**:
A Room with a unique name (ignoring case) that any User can join by themselves. It starts with its creator as the only Member and is never deleted.
_Avoid_: Channel, chat group, group chat

**Member**:
A User who has created or joined a Group. Membership never ends.
_Avoid_: Participant, subscriber

**Message**:
A piece of text a User sends into one Room, visible only to that Room's Users (both sides of a Private Room, or a Group's Members, including ones who joined later).
_Avoid_: Chat, post
