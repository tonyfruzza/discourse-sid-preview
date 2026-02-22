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

# Ensure the icons used in the player template are included in Discourse's SVG sprite.
register_svg_icon "stop"
register_svg_icon "redo"

# WebAssembly requires 'wasm-unsafe-eval' in the script-src CSP directive.
# This is a narrowly-scoped permission that only allows WASM compilation —
# it does NOT permit general eval() or inline scripts.
extend_content_security_policy(script_src: ["'wasm-unsafe-eval'"])

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
