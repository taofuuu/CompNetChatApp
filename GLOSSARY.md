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
A Room with a unique name (ignoring case) that any User can join by themselves. It starts with its creator as the only Member. When its last Member leaves, after a warning, the Group is deleted with its Messages and Announcements, and its name is free again.
_Avoid_: Channel, chat group, group chat

**Member**:
A User who has created or joined a Group and hasn't left it. A Member can leave, and while the Group has other Members, can come back with Join and see the full history.
_Avoid_: Participant, subscriber

**Member Panel**:
The column beside an open Room showing who is in it: a Group's Members, or both Users of a Private Room, under Online and Offline headings with counts. It never lists bot.
_Avoid_: Member list, user list, right sidebar

**bot**:
The AI that answers a Message starting with `@bot` in any Room: a Private Room or a Group. It is not a User: nobody can register or log in as bot, and it never appears in the Online List. Its replies are saved as Messages.
_Avoid_: Chatbot (reserved for a possible AI feature, not the product), assistant

**Lesson**:
One of the course's lecture decks, numbered, e.g. Lesson 3 (Transport Layer).
_Avoid_: Lecture, chapter, week

**Slide**:
One page of a Lesson's deck, kept as text so bot can answer from it and cite it as "Lesson 3 (Transport Layer), slide 42". Slides are loaded by hand from PDFs and never committed, since the repo is public.
_Avoid_: Page, document, chunk

**Message**:
A piece of text a User, or bot, sends into one Room, visible only to that Room's Users (both sides of a Private Room, or a Group's Members, including ones who joined later).
_Avoid_: Chat, post

**Unsend**:
What a User does to one of their own Messages, at any time, while they are in its Room. Its text is wiped for good, and everyone in the Room sees "alice unsent a Message" in its place, with the same time. bot's Messages can't be unsent, and bot's reply to an unsent `@bot` question stays.
_Avoid_: Delete, recall, retract

**Announcement**:
A line the Chat App itself adds to a Group's Room when something happens to the Group, such as "bob joined the Group" or "bob left the Group", shown centred and grey with its time. It is not a Message: no User or bot sends it, so it can't be unsent, it raises no unread count and bot never sees it. It stays in the Room's history, so a Member who joins later sees it too. Creating a Group adds none, and Private Rooms never have any.
_Avoid_: System message, notice, notification
