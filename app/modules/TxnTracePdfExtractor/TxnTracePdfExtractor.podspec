require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "TxnTracePdfExtractor"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = "https://github.com/txntrace"
  s.license      = "MIT"
  s.authors      = "TxnTrace"

  s.platforms    = { :ios => "13.0" }
  s.source       = { :git => "", :tag => "#{s.version}" }

  s.source_files = "ios/**/*.{h,m,mm,swift}"

  s.dependency "React-Core"
end
