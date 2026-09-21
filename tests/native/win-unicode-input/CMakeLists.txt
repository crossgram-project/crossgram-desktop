cmake_minimum_required(VERSION 3.21)
project(crossgram_win_unicode_input_harness LANGUAGES CXX)

if(NOT DEFINED CROSSGRAM_SOURCE_ROOT)
  message(FATAL_ERROR "Pass -DCROSSGRAM_SOURCE_ROOT=<patched Telegram/SourceFiles>")
endif()

find_package(Qt6 6.8 REQUIRED COMPONENTS Core Gui Widgets)

add_executable(crossgram_win_unicode_input_harness
  main.cpp
  "${CROSSGRAM_SOURCE_ROOT}/crossgram/win_unicode_input.cpp"
)
target_compile_features(crossgram_win_unicode_input_harness PRIVATE cxx_std_20)
target_include_directories(crossgram_win_unicode_input_harness PRIVATE
  "${CROSSGRAM_SOURCE_ROOT}"
)
target_link_libraries(crossgram_win_unicode_input_harness PRIVATE
  Qt6::Core
  Qt6::Gui
  Qt6::Widgets
)
