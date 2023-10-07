# Bluesky Mutebot

**⚠️ Mutbot is not currently functional, see *Current Status* below**

Mutebot is a project to provide a mute words functionality for [Bluesky](https://bsky.app) consisting of a custom feed that respects muted words and a bot to mute and unmute words.

This is currently running using the [@mutebot.bsky.social](https://bsky.app/profile/mutebot.bsky.social).

## Description

Bluesky currently lacks muted words. I hope that will be added as a first party feature in future, but in the interim Mutebot is attempting to solve that.

The [Mutebot - Following](https://bsky.app/profile/did:plc:k626emd4xi4h3wxpd44s4wpk/feed/pkiiapsnaqxs) feed is the key to using Mutebot. This is intended as a drop in replacement for the built in Following feed. This shows:
* Bleets by people you follow
* Replies to Bleets if the are both:
  * made by someone you follow
  * replying to someone you follow

The key difference from the Following feed is that this feed filters out Bleets that contain words you have muted.

To mute a word Bleet:

```
@mutebot.bsky.social mute <one or more words you want to mute>
```

To unmute a word Bleet:

```
@mutebot.bsky.social unmute <one or more words you want to unmute>
```

## Current Status

**Mutebot is currently not working.**

This version of the project was having Mutebot follow everyone in order to source Bleets to filter. This got out of hand and does not scale for any number of people.

This current version is published more for reference and interest.

Work is underway on updating Mutebot to use the Bluesky firehose to source Bleets which should make this a sustainable project.

## Technology Overview

This is a [Serverless](https://serverless.com/) Project designed to be deployed with AWS Lambda. It consists of the following lambda functions:
* HTTP Endpoints
  * [did](src/endpoints/did/index.ts) - Serves `/.well-known/did.json` to declare the deployment as an XRPC server providing a Bluesky feed generator
  * [getFeedSkeleton](src/endpoints/getFeedSkeleton/index.ts) - provides the feed skeleton required for a Bluesky feed. Essentially this will return a list of post urls for the `Mutebot - Following` feed for whatever user is getting their feed
* Data sourcing Endpoints
  * [notificationListener](src/endpoints/notificationListener/index.ts) - polls for new notifications for the `@mutebot.bsky.social` to find mute and unmute commands
  * [readFirehose](src/endpoints/readFirehose/index.ts) - polls the bluesky fire hose to populate the posts table with bleets by people followed by someone using mutebot 
  * [syncSubscriberFollowing](src/endpoints/syncSubscriberFollowing/index.ts) - triggered indirection by people looking at the Mutebot feed, this sources the list of people someone follows and saves them so we can provide their feed. At the moment this also indirectly triggers following all the persons followers
* Internal processing functions
  * [syncSubscriberFollowing-onFolUnfol](src/endpoints/syncSubscriberFollowing/onFollowUnfollow.ts) - listens for followed entries in SubscriberFollowingTable that no longer have any followers and sets an expiry so they'll be removed in 7 days

## Environment parameters

The following SSM parameters must be setup in the AWS account where this project is deployed to provide the environment specific information:
* `deployment-artifacts-bucket` - the S3 bucket serverless should use for deployment
* `/bluesky-feeds/<production|development>/service/user-did` - the `did` of the bluesky account the service acts as. I.e. the mutebot account
* `/bluesky-feeds/<production|development>/domain-name` - the domain name to host the custom feed on. A Route53 zone must already be setup that the appropriate records can be added to.
* `/bluesky-feeds/<production|development>/certificate-arn` - the ARN of the AWS ACM certificate used for HTTPs on the feed generator. This must be valid for the domain name
* `/bluesky-feeds/<production|development>/service/identifier` - the username of the Bluesky account the service acts as e.g. `@mutebot.bsky.social`
* `/bluesky-feeds/<production|development>/service/password` - the app password used to authenticate the Bluesky account 


## Data Stores

Amazon Dynamo DB is primarily used for storing data records. The tables are:
* `SyncSubscriberQueueTable` - people who should have thier following lists synced are written into this table to trigger `syncSubscriberFollowing`. The indirection allows us to do a "sync if they haven't been synced in 30 minutes" flow and decouple the syncing of followers from the feed generation.
* `SubscriberFollowingTable` - the list of people who each user follows. This contains two types of record:
  * A record for each user keyed by their `did` that saves the list of people they follow
  * Records in the `aggregate` partition that are one record per person followed with a count of how man users follow them. These records trigger are used to filter the firehose to only Bleets by people someone cares to follow
* `PostsTable` - the posts for everyone followed by someone using mutebot that is used to populate the feed
* `MuteWordsTable` - the list of mute words for each user. Partition key is the user's `did` with the range key being a muted word
* `AppStatusTable` - used to store various state between lambda invocations. Keys are:
  * `firehose-cursor` - for the cursor of where to resume the firehose read

## Getting Involved

Right now this is very  much a hobby project, but if you're interested reach out to [@orthanc.bsky.social](https://bsky.app/profile/orthanc.bsky.social).