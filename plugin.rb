# frozen_string_literal: true

# name: discourse-sid-preview
# about: Inline SID file preview player for Commodore 64 .sid uploads
# meta_topic_id: TODO
# version: 0.2.0
# authors: Tony
# url: https://github.com/TODO/discourse-sid-preview
# required_version: 2.7.0

enabled_site_setting :sid_preview_enabled

register_asset "stylesheets/common/sid-player.scss"

after_initialize do
  # Ensure .sid is in the list of authorized extensions if the plugin is enabled
  # Admins should also add "sid" to the authorized_extensions site setting

  # Copy websidplayfp vendor files into public/ so they are served as static
  # assets at /sid-player/<filename> without going through the Ember build.
  src_dir = File.join(File.dirname(__FILE__), "vendor", "sid-player")
  dst_dir = File.join(Rails.root, "public", "sid-player")
  FileUtils.mkdir_p(dst_dir)
  Dir.glob(File.join(src_dir, "*")).each do |f|
    FileUtils.cp(f, dst_dir) unless File.directory?(f)
  end
end
