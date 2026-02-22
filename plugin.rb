# frozen_string_literal: true

# name: discourse-sid-preview
# about: Inline SID file preview player for Commodore 64 .sid uploads
# meta_topic_id: TODO
# version: 0.1.0
# authors: Tony
# url: https://github.com/TODO/discourse-sid-preview
# required_version: 2.7.0

enabled_site_setting :sid_preview_enabled

register_asset "stylesheets/common/sid-player.scss"

after_initialize do
  # Ensure .sid is in the list of authorized extensions if the plugin is enabled
  # Admins should also add "sid" to the authorized_extensions site setting
end
