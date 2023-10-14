# Privacy Statement

By necessity, Mutebot collect personal information from you, including information about your:

* Use of the Mutebot feed
* Bluesky Handle and DID
* Who you follow
* What words you mute

We collect your personal information in order to:

* Populate and filter the Mutebot feed for you

This information is only available to the Mutebot administrator ( [@orthanc.bsky.social](https://bsky.app/profile/orthanc.bsky.social) ) this information will never be shared in it's raw form.

Statistics, metrics and other aggregate information about Mutebot use MAY be shared publicly but this will never be done in a way that could identify individual users without their explicit consent.

We keep your information safe by storing it securely in AWS Dynamo DB and limiting access to the administrator of Mutebot .
We keep your information for 7 days after you last uses Mutebot at which point we securely destroy it by deleting all copies of it in an automated fashion.

You have the right to ask for a copy of any personal information we hold about you, and to ask for it to be corrected if you think it is wrong. If you’d like to ask for a copy of your information, or to have it corrected, please contact us at eds.catchall at gmail dot com.

# Some Details and Commitments

Mutebot only collects the information that is needed to populate your feed and operate the service.

Muted words and following lists are stored against your Bluesky DID. The DID is a string that identifies your Bluesky account (for example. Orthanc's DID is `did:plc:crngjmsdh3zpuhmd5gtgwx6q`). As the administrator, Orthanc does have the ability to look up what words a DID has muted and work out what handle that is, this would only done for purposes of operating and debugging Mutebot. Your DID is public information, anyone can look it up, but this does mean Orthanc won't accidentally see a list of mute words associated with a Bluesky handle.

Mutebot is a project provided for the good of the community. The data captured will not be sold or shared. The project will not be sold.

If costs get out of hand in future or Orthanc is unable to keep operating this for other reasons the current Mutebot will be shut down rather than access given to another individual or organisation.

If there is still need for a Mutebot at that time, the project is open source and another individual or organisation can stand it up allowing people to choose whether they wish to trust another party with their data.